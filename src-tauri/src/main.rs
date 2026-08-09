#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    let arguments: Vec<_> = std::env::args_os().collect();
    if myterm_lib::cli::requested(&arguments) {
        std::process::exit(myterm_lib::cli::run(arguments));
    }
    myterm_lib::run();
}
