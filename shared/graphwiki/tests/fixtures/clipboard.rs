use std::{env, fs::File, io};

fn main() -> io::Result<()> {
    let destination = env::var_os("GRAPHWIKI_CLIPBOARD_FILE").expect("clipboard test destination");
    let mut file = File::create(destination)?;
    io::copy(&mut io::stdin().lock(), &mut file)?;
    Ok(())
}
