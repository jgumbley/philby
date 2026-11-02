use std::io::{self, Write};

use crossterm::{cursor, event, execute, queue, style, terminal};

use super::document::{Document, Target};

pub struct Terminal;

impl Terminal {
    pub fn open() -> io::Result<Self> {
        terminal::enable_raw_mode()?;
        let terminal = Self;
        execute!(
            io::stdout(),
            terminal::EnterAlternateScreen,
            cursor::Hide,
            event::EnableMouseCapture
        )?;
        Ok(terminal)
    }
}

impl Drop for Terminal {
    fn drop(&mut self) {
        let _ = execute!(
            io::stdout(),
            event::DisableMouseCapture,
            cursor::Show,
            terminal::LeaveAlternateScreen
        );
        let _ = terminal::disable_raw_mode();
    }
}

pub fn draw(
    document: &Document,
    offset: usize,
    selected: Option<usize>,
    message: &str,
) -> io::Result<()> {
    let (width, height) = terminal::size()?;
    let mut output = io::stdout();
    header(&mut output, width)?;
    body(&mut output, document, (offset, height), selected)?;
    footer(&mut output, message, (width, height))
}

fn header(output: &mut impl Write, width: u16) -> io::Result<()> {
    queue!(
        output,
        terminal::Clear(terminal::ClearType::All),
        cursor::MoveTo(0, 0)
    )?;
    write!(
        output,
        "{}",
        clipped("[ Wiki ] [ Journal ] [ Back ]   Graphwiki", width)
    )
}

fn body(
    output: &mut impl Write,
    document: &Document,
    viewport: (usize, u16),
    selected: Option<usize>,
) -> io::Result<()> {
    for (row, cells) in document
        .rows
        .iter()
        .skip(viewport.0)
        .take(viewport.1.saturating_sub(3) as usize)
        .enumerate()
    {
        queue!(output, cursor::MoveTo(0, row as u16 + 2))?;
        for cell in cells {
            print_cell(output, cell, document, selected)?;
        }
    }
    Ok(())
}

fn footer(output: &mut impl Write, message: &str, size: (u16, u16)) -> io::Result<()> {
    queue!(
        output,
        style::ResetColor,
        cursor::MoveTo(0, size.1.saturating_sub(1))
    )?;
    write!(output, "{}", clipped(message, size.0))?;
    output.flush()
}

fn clipped(text: &str, width: u16) -> String {
    text.chars()
        .filter(|c| !c.is_control())
        .take(width as usize)
        .collect()
}

fn print_cell(
    output: &mut impl Write,
    cell: &super::document::Cell,
    document: &Document,
    selected: Option<usize>,
) -> io::Result<()> {
    queue!(
        output,
        style::SetForegroundColor(color(cell.link, selected))
    )?;
    if let Some(Target::Web(url)) = cell.link.map(|i| &document.links[i]) {
        let url: String = url.chars().filter(|c| !c.is_control()).collect();
        write!(output, "\x1b]8;;{url}\x1b\\{}\x1b]8;;\x1b\\", cell.text)
    } else {
        write!(output, "{}", cell.text)
    }
}

fn color(link: Option<usize>, selected: Option<usize>) -> style::Color {
    match link {
        Some(link) if Some(link) == selected => style::Color::Yellow,
        Some(_) => style::Color::Cyan,
        None => style::Color::Reset,
    }
}

pub fn clicked(document: &Document, offset: usize, column: u16, row: u16) -> Option<usize> {
    let cells = document.rows.get(offset + row.checked_sub(2)? as usize)?;
    let mut position = 0;
    for cell in cells {
        position += cell.width;
        if (column as usize) < position {
            return cell.link;
        }
    }
    None
}
