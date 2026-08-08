use std::process::Command;

fn main() {
    let commit_hash = Command::new("git")
        .args(["rev-parse", "--short=12", "HEAD"])
        .output()
        .ok()
        .filter(|output| output.status.success())
        .and_then(|output| String::from_utf8(output.stdout).ok())
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .unwrap_or_else(|| "uncommitted".to_owned());
    println!("cargo:rustc-env=MYTERM_COMMIT_HASH={commit_hash}");
    println!("cargo:rerun-if-changed=../.git/HEAD");
    tauri_build::build();
}
