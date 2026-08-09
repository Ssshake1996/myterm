use std::{
    ffi::OsString,
    io::{self, IsTerminal, Read, Write},
    sync::Arc,
    time::Duration,
};

use clap::{Args, Parser, Subcommand, ValueEnum};
use tokio::sync::mpsc;

use crate::{
    agent::{service::AgentEventSink, store::AgentStore},
    config::{default_config_path, ConfigService, CredentialVault, KeyringVault},
    session::manager::{NullEventSink, OutputSink, SessionManager},
    sftp::service::{NullTransferSink, SftpService},
    types::{AgentEvent, AgentPermissionMode, SessionProfile},
    AppError, SecretResolver,
};

const EXIT_SUCCESS: i32 = 0;
const EXIT_USAGE: i32 = 2;
const EXIT_FAILED: i32 = 10;
const EXIT_CANCELED: i32 = 11;
const EXIT_WAITING_APPROVAL: i32 = 12;
const EXIT_UNAVAILABLE: i32 = 14;

#[derive(Parser)]
#[command(
    name = "myterm",
    version,
    about = "myterm terminal and Linux Agent CLI"
)]
struct Cli {
    #[command(subcommand)]
    command: RootCommand,
}

#[derive(Subcommand)]
enum RootCommand {
    Agent(AgentCommand),
    Api(ApiCommand),
    Task(TaskCommand),
}

#[derive(Args)]
struct ApiCommand {
    #[command(subcommand)]
    command: ApiSubcommand,
}

#[derive(Subcommand)]
enum ApiSubcommand {
    Serve {
        #[arg(long, default_value = "127.0.0.1:9867")]
        bind: std::net::SocketAddr,
    },
    Token {
        #[command(subcommand)]
        command: TokenSubcommand,
    },
}

#[derive(Subcommand)]
enum TokenSubcommand {
    Create,
    Revoke,
}

#[derive(Args)]
struct AgentCommand {
    #[command(subcommand)]
    command: AgentSubcommand,
}

#[derive(Subcommand)]
enum AgentSubcommand {
    Run(AgentRunArgs),
    Serve {
        #[arg(long, default_value_t = 300)]
        idle_timeout: u64,
    },
}

#[derive(Args)]
struct AgentRunArgs {
    #[arg(long)]
    server: String,
    #[arg(long)]
    task: String,
    #[arg(long)]
    ai_profile: Option<String>,
    #[arg(long, value_enum)]
    permission: Option<CliPermission>,
    #[arg(long, value_enum, default_value_t = OutputMode::Human)]
    output: OutputMode,
}

#[derive(Clone, Copy, ValueEnum)]
enum CliPermission {
    ReadOnly,
    Confirm,
    TaskGrant,
}

impl From<CliPermission> for AgentPermissionMode {
    fn from(value: CliPermission) -> Self {
        match value {
            CliPermission::ReadOnly => Self::ReadOnly,
            CliPermission::Confirm => Self::Confirm,
            CliPermission::TaskGrant => Self::TaskGrant,
        }
    }
}

#[derive(Clone, Copy, ValueEnum, PartialEq, Eq)]
enum OutputMode {
    Human,
    Jsonl,
}

#[derive(Args)]
struct TaskCommand {
    #[command(subcommand)]
    command: TaskSubcommand,
}

#[derive(Subcommand)]
enum TaskSubcommand {
    List {
        #[arg(long, default_value_t = 20)]
        limit: usize,
        #[arg(long, value_enum, default_value_t = TaskOutputMode::Human)]
        output: TaskOutputMode,
    },
    Status {
        run_id: String,
        #[arg(long, value_enum, default_value_t = TaskOutputMode::Human)]
        output: TaskOutputMode,
    },
    Events {
        run_id: String,
        #[arg(long, default_value_t = 0)]
        after: u64,
        #[arg(long)]
        follow: bool,
    },
    Approve {
        run_id: String,
        approval_id: String,
        #[arg(long, value_enum)]
        decision: ApprovalDecision,
    },
    Cancel {
        run_id: String,
    },
}

#[derive(Clone, Copy, ValueEnum, PartialEq, Eq)]
enum TaskOutputMode {
    Human,
    Json,
}

#[derive(Clone, Copy, ValueEnum)]
enum ApprovalDecision {
    ApproveOnce,
    AllowRuleForRun,
    Deny,
}

struct DiscardOutput;

impl OutputSink for DiscardOutput {
    fn send(&self, _data: &[u8]) -> Result<(), AppError> {
        Ok(())
    }
}

struct CliEventSink(mpsc::UnboundedSender<AgentEvent>);

impl AgentEventSink for CliEventSink {
    fn send(&self, event: AgentEvent) -> Result<(), AppError> {
        self.0
            .send(event)
            .map_err(|_| AppError::Agent("CLI event receiver closed".to_owned()))
    }
}

pub fn requested(arguments: &[OsString]) -> bool {
    arguments
        .get(1)
        .and_then(|value| value.to_str())
        .is_some_and(|value| matches!(value, "agent" | "api" | "task"))
}

pub fn run(arguments: Vec<OsString>) -> i32 {
    attach_parent_console();
    let cli = match Cli::try_parse_from(arguments) {
        Ok(cli) => cli,
        Err(error) => {
            let exit_code = if matches!(
                error.kind(),
                clap::error::ErrorKind::DisplayHelp | clap::error::ErrorKind::DisplayVersion
            ) {
                EXIT_SUCCESS
            } else {
                EXIT_USAGE
            };
            let _ = error.print();
            return exit_code;
        }
    };
    let runtime = match tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .worker_threads(2)
        .build()
    {
        Ok(runtime) => runtime,
        Err(error) => {
            eprintln!("unable to start Agent runtime: {error}");
            return EXIT_UNAVAILABLE;
        }
    };
    match runtime.block_on(run_async(cli)) {
        Ok(code) => code,
        Err(error) => {
            eprintln!("{error}");
            EXIT_UNAVAILABLE
        }
    }
}

async fn run_async(cli: Cli) -> Result<i32, AppError> {
    match cli.command {
        RootCommand::Agent(command) => match command.command {
            AgentSubcommand::Run(arguments) => run_agent(arguments).await,
            AgentSubcommand::Serve { idle_timeout } => {
                eprintln!(
                    "headless core is ready; task control uses the shared SQLite store (idle timeout: {idle_timeout}s)"
                );
                tokio::select! {
                    _ = tokio::time::sleep(Duration::from_secs(idle_timeout.max(1))) => {}
                    _ = tokio::signal::ctrl_c() => {}
                }
                Ok(EXIT_SUCCESS)
            }
        },
        RootCommand::Task(command) => run_task(command).await,
        RootCommand::Api(command) => match command.command {
            ApiSubcommand::Serve { bind } => {
                eprintln!("myterm REST listening on http://{bind}");
                crate::rest::serve(bind).await?;
                Ok(EXIT_SUCCESS)
            }
            ApiSubcommand::Token { command } => match command {
                TokenSubcommand::Create => {
                    println!("{}", crate::rest::create_token()?);
                    eprintln!("token is shown once; store it in a secret manager");
                    Ok(EXIT_SUCCESS)
                }
                TokenSubcommand::Revoke => {
                    crate::rest::revoke_token()?;
                    eprintln!("REST token revoked");
                    Ok(EXIT_SUCCESS)
                }
            },
        },
    }
}

async fn run_agent(arguments: AgentRunArgs) -> Result<i32, AppError> {
    let prompt = read_task(&arguments.task)?;
    let config_path = default_config_path(false)?;
    let config = Arc::new(ConfigService::open(config_path)?);
    let server = find_server(&config, &arguments.server)?;
    let ai_profile = match arguments.ai_profile.as_deref() {
        Some(reference) => config
            .ai_profile_list()?
            .into_iter()
            .find(|profile| profile.id == reference || profile.name == reference)
            .ok_or_else(|| AppError::NotFound(format!("AI profile '{reference}'")))?,
        None => config
            .ai_profile_list()?
            .into_iter()
            .next()
            .ok_or_else(|| AppError::NotFound("AI profile".to_owned()))?,
    };
    let vault_impl = Arc::new(KeyringVault::new());
    let vault: Arc<dyn CredentialVault> = vault_impl.clone();
    let resolver: Arc<dyn SecretResolver> = vault_impl;
    let sessions = Arc::new(SessionManager::new(resolver, Arc::new(NullEventSink)));
    let sftp = Arc::new(SftpService::new(
        sessions.clone(),
        Arc::new(NullTransferSink),
    ));
    let agent = Arc::new(crate::agent::service::AgentService::new(
        config,
        vault,
        sessions.clone(),
        sftp,
    )?);
    let session = sessions
        .connect(server, 120, 36, Arc::new(DiscardOutput))
        .await?;
    let session_id = session.session_id;
    let (event_tx, mut event_rx) = mpsc::unbounded_channel();
    let run_agent = agent.clone();
    let run_session_id = session_id.clone();
    let permission = arguments.permission.map(Into::into);
    let mut task = tokio::spawn(async move {
        run_agent
            .run_with_permission(
                &ai_profile.id,
                prompt,
                Some(run_session_id),
                Arc::new(CliEventSink(event_tx)),
                permission,
            )
            .await
    });
    let mut approval_blocked = false;
    let interrupt = tokio::signal::ctrl_c();
    tokio::pin!(interrupt);

    let result = loop {
        tokio::select! {
            event = event_rx.recv() => {
                let Some(event) = event else { continue };
                print_event(&event, arguments.output)?;
                if event.event_type == "approval_required" {
                    let approved = if arguments.output == OutputMode::Human && io::stdin().is_terminal() {
                        prompt_for_approval(&event)?
                    } else {
                        approval_blocked = true;
                        false
                    };
                    if let Some(call_id) = event.call_id.as_deref() {
                        agent.approve(call_id, approved).await?;
                    }
                }
            }
            joined = &mut task => break joined.map_err(|error| AppError::Agent(error.to_string()))??,
            _ = &mut interrupt => {
                agent.abort().await;
            }
        }
    };
    let _ = sessions.disconnect(&session_id).await;
    if approval_blocked {
        return Ok(EXIT_WAITING_APPROVAL);
    }
    Ok(match result.finish_reason.as_str() {
        "stop" => EXIT_SUCCESS,
        "aborted" => EXIT_CANCELED,
        _ => EXIT_FAILED,
    })
}

async fn run_task(command: TaskCommand) -> Result<i32, AppError> {
    let store = task_store()?;
    match command.command {
        TaskSubcommand::List { limit, output } => {
            for task in store.tasks(limit)? {
                if output == TaskOutputMode::Json {
                    println!("{}", serde_json::to_string(&task)?);
                } else {
                    println!("{}\t{}\t{}", task.id, task.state.as_str(), task.prompt);
                }
            }
        }
        TaskSubcommand::Status { run_id, output } => {
            let task = store
                .task(&run_id)?
                .ok_or_else(|| AppError::NotFound(format!("agent task '{run_id}'")))?;
            if output == TaskOutputMode::Json {
                println!("{}", serde_json::to_string_pretty(&task)?);
            } else {
                println!(
                    "task: {}\nstate: {}\nsteps: {}\nreason: {}",
                    task.id,
                    task.state.as_str(),
                    task.steps,
                    task.finish_reason.as_deref().unwrap_or("-")
                );
            }
        }
        TaskSubcommand::Events {
            run_id,
            mut after,
            follow,
        } => loop {
            let events = store.events_after(&run_id, after, 1_000)?;
            for event in &events {
                println!("{}", serde_json::to_string(event)?);
                after = event.sequence;
            }
            io::stdout().flush()?;
            let terminal = store
                .task(&run_id)?
                .ok_or_else(|| AppError::NotFound(format!("agent task '{run_id}'")))?
                .state
                .is_terminal();
            if !follow || terminal {
                break;
            }
            tokio::time::sleep(Duration::from_millis(250)).await;
        },
        TaskSubcommand::Approve {
            run_id,
            approval_id,
            decision,
        } => {
            let task = store
                .task(&run_id)?
                .ok_or_else(|| AppError::NotFound(format!("agent task '{run_id}'")))?;
            if task.state.is_terminal() {
                return Err(AppError::Agent("task is already terminal".to_owned()));
            }
            store.approval_decided(&approval_id, !matches!(decision, ApprovalDecision::Deny))?;
            if matches!(decision, ApprovalDecision::AllowRuleForRun) {
                eprintln!(
                    "exact run-rule grants are conservatively treated as approve-once in 0.6.0"
                );
            }
        }
        TaskSubcommand::Cancel { run_id } => {
            if !store.request_cancel(&run_id)? {
                let task = store
                    .task(&run_id)?
                    .ok_or_else(|| AppError::NotFound(format!("agent task '{run_id}'")))?;
                if !task.state.is_terminal() {
                    return Ok(EXIT_UNAVAILABLE);
                }
            }
        }
    }
    Ok(EXIT_SUCCESS)
}

fn task_store() -> Result<AgentStore, AppError> {
    let config_path = default_config_path(false)?;
    let path = config_path
        .parent()
        .unwrap_or_else(|| std::path::Path::new("."))
        .join("agent.db");
    Ok(AgentStore::new(path))
}

fn find_server(config: &ConfigService, reference: &str) -> Result<SessionProfile, AppError> {
    let profiles = config.profile_list()?;
    if let Some(profile) = profiles.iter().find(|profile| profile.id == reference) {
        return Ok(profile.clone());
    }
    let matches = profiles
        .into_iter()
        .filter(|profile| profile.name == reference)
        .collect::<Vec<_>>();
    match matches.as_slice() {
        [profile] => Ok(profile.clone()),
        [] => Err(AppError::NotFound(format!("server profile '{reference}'"))),
        _ => Err(AppError::InvalidInput(format!(
            "server name '{reference}' is ambiguous; use its profile ID"
        ))),
    }
}

fn read_task(value: &str) -> Result<String, AppError> {
    if value != "-" {
        return Ok(value.to_owned());
    }
    let mut task = String::new();
    io::stdin().read_to_string(&mut task)?;
    if task.trim().is_empty() {
        return Err(AppError::InvalidInput(
            "task from stdin is empty".to_owned(),
        ));
    }
    Ok(task)
}

fn print_event(event: &AgentEvent, output: OutputMode) -> Result<(), AppError> {
    if output == OutputMode::Jsonl {
        println!("{}", serde_json::to_string(event)?);
    } else {
        match event.event_type.as_str() {
            "status" => println!(
                "[{}] {}",
                event.step.unwrap_or(0),
                event.message.as_deref().unwrap_or("running")
            ),
            "tool_requested" => {
                println!("tool {}", event.tool_name.as_deref().unwrap_or("unknown"))
            }
            "tool_output" => print!("{}", event.content.as_deref().unwrap_or_default()),
            "tool_result" if event.is_error == Some(true) => eprintln!(
                "tool error: {}",
                event.content.as_deref().unwrap_or_default()
            ),
            "assistant" => println!("{}", event.content.as_deref().unwrap_or_default()),
            "complete" => println!("task {}", event.message.as_deref().unwrap_or("complete")),
            _ => {}
        }
    }
    io::stdout().flush()?;
    Ok(())
}

fn prompt_for_approval(event: &AgentEvent) -> Result<bool, AppError> {
    eprint!(
        "Allow tool {} for this call? [y/N] ",
        event.tool_name.as_deref().unwrap_or("unknown")
    );
    io::stderr().flush()?;
    let mut answer = String::new();
    io::stdin().read_line(&mut answer)?;
    Ok(matches!(
        answer.trim().to_ascii_lowercase().as_str(),
        "y" | "yes"
    ))
}

#[cfg(windows)]
fn attach_parent_console() {
    unsafe {
        let _ = windows_sys::Win32::System::Console::AttachConsole(u32::MAX);
    }
}

#[cfg(not(windows))]
fn attach_parent_console() {}

#[cfg(test)]
mod tests {
    use super::{requested, Cli};
    use clap::Parser;
    use std::ffi::OsString;

    #[test]
    fn detects_cli_without_intercepting_desktop_flags() {
        assert!(requested(&[
            OsString::from("myterm"),
            OsString::from("agent")
        ]));
        assert!(!requested(&[
            OsString::from("myterm"),
            OsString::from("--profile"),
            OsString::from("server")
        ]));
    }

    #[test]
    fn cli_contract_parses_jsonl_and_stdin_task() {
        let cli = Cli::try_parse_from([
            "myterm", "agent", "run", "--server", "prod", "--task", "-", "--output", "jsonl",
        ]);
        assert!(cli.is_ok());
    }
}
