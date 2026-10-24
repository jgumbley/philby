use std::{env, path::Path, process::ExitCode};

const USAGE: &str = "Usage: graphwiki <operation> <graph-root> <argument>

Operations:
  context <graph-root> <query>   Search pages and linked source pages
  publish <graph-root> <change> Publish .drafts/<change>/pages
  index   <graph-root> ''       Regenerate pages/index.md
  lint    <graph-root> ''       Check pages and report unresolved links

Run graphwiki without arguments or with --help to show this help.
";

fn execute() -> graphwiki::Result<()> {
    let args: Vec<String> = env::args().skip(1).collect();
    if help_requested(&args) {
        print!("{USAGE}");
        return Ok(());
    }
    let [operation, root, argument] = args.as_slice() else {
        return Err(USAGE.into());
    };
    print!(
        "{}",
        graphwiki::execute(operation, Path::new(root), argument)?
    );
    Ok(())
}

fn help_requested(args: &[String]) -> bool {
    args.is_empty() || args == ["--help"] || args == ["-h"]
}

fn main() -> ExitCode {
    match execute() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("error: {error}");
            ExitCode::FAILURE
        }
    }
}
