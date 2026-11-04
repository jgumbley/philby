use std::{
    env,
    fs::{File, OpenOptions},
    io::{self, Write},
    path::PathBuf,
};

fn main() -> io::Result<()> {
    let executable = PathBuf::from(env::args_os().next().unwrap());
    let name = executable.file_name().unwrap().to_str().unwrap();
    if name == "uname" {
        println!("{}", env::var("GRAPHWIKI_CLIPBOARD_PLATFORM").unwrap());
        return Ok(());
    }
    record_call(name)?;
    if env::var_os("GRAPHWIKI_CLIPBOARD_FAIL").is_some() {
        return Err(io::Error::other("Clipboard copy failed"));
    }
    check_arguments(name);
    copy_clipboard()
}

fn record_call(name: &str) -> io::Result<()> {
    let mut calls = OpenOptions::new()
        .create(true)
        .append(true)
        .open(env::var_os("GRAPHWIKI_CLIPBOARD_CALLS").unwrap())?;
    writeln!(calls, "{name}")
}

fn check_arguments(name: &str) {
    let arguments: Vec<_> = env::args().skip(1).collect();
    if name == "xclip" {
        assert_eq!(arguments, ["-selection", "clipboard"]);
    } else {
        assert!(arguments.is_empty());
    }
}

fn copy_clipboard() -> io::Result<()> {
    let destination = env::var_os("GRAPHWIKI_CLIPBOARD_FILE").expect("clipboard test destination");
    let mut file = File::create(destination)?;
    io::copy(&mut io::stdin().lock(), &mut file)?;
    Ok(())
}
