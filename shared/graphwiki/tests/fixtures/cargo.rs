use std::{env, io, process::Command};

fn main() -> io::Result<()> {
    let arguments: Vec<String> = env::args().skip(1).collect();
    assert_eq!(arguments.len(), 7);
    assert_eq!(arguments[..4], ["run", "--locked", "--quiet", "--"]);
    assert_eq!(
        env::var_os("CARGO_TARGET_DIR"),
        env::var_os("GRAPHWIKI_EXPECTED_TARGET_DIR")
    );
    let status = Command::new(env::var_os("GRAPHWIKI_BINARY").unwrap())
        .args(&arguments[4..])
        .status()?;
    std::process::exit(status.code().unwrap_or(1));
}
