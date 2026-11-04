use std::io::{self, Write};

use crossterm::{cursor, event, execute, queue, style, terminal};

use style::Attribute::{Bold, Italic, Reverse, Underlined};

use super::document::{Cell, Document, Target};

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

const TABS: [(&str, style::Color); 3] = [
    (
        " Wiki ",
        style::Color::Rgb {
            r: 97,
            g: 175,
            b: 239,
        },
    ),
    (
        " Journal ",
        style::Color::Rgb {
            r: 229,
            g: 192,
            b: 123,
        },
    ),
    (
        " Back ",
        style::Color::Rgb {
            r: 198,
            g: 120,
            b: 221,
        },
    ),
];
const BAR: style::Color = style::Color::Rgb {
    r: 40,
    g: 44,
    b: 52,
};
const DIM: style::Color = style::Color::Rgb {
    r: 92,
    g: 99,
    b: 112,
};
const TEXT: style::Color = style::Color::Rgb {
    r: 171,
    g: 178,
    b: 191,
};

fn header(output: &mut impl Write, width: u16) -> io::Result<()> {
    queue!(
        output,
        style::SetAttribute(style::Attribute::Reset),
        terminal::Clear(terminal::ClearType::All),
        cursor::MoveTo(0, 0),
        style::SetBackgroundColor(BAR)
    )?;
    for (label, color) in TABS {
        tab(output, label, color)?;
    }
    let used: usize = TABS.iter().map(|(label, _)| label.len() + 1).sum();
    queue!(
        output,
        style::SetForegroundColor(DIM),
        style::Print(format!(
            "{:<1$}",
            "  Graphwiki",
            (width as usize).saturating_sub(used)
        )),
        style::ResetColor,
        cursor::MoveTo(0, 1),
        style::SetForegroundColor(DIM),
        style::Print("─".repeat(width as usize)),
        style::ResetColor
    )
}

fn tab(output: &mut impl Write, label: &str, color: style::Color) -> io::Result<()> {
    queue!(
        output,
        style::SetForegroundColor(color),
        style::SetAttribute(style::Attribute::Bold),
        style::Print(label),
        style::SetAttribute(style::Attribute::NormalIntensity),
        style::Print(" ")
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
    let text = clipped(message, size.0);
    let fill = " ".repeat((size.0 as usize).saturating_sub(text.chars().count()));
    queue!(
        output,
        style::SetAttribute(style::Attribute::Reset),
        cursor::MoveTo(0, size.1.saturating_sub(1)),
        style::SetBackgroundColor(BAR),
        style::SetForegroundColor(TEXT),
        style::Print(text),
        style::Print(fill),
        style::ResetColor
    )?;
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
    cell: &Cell,
    document: &Document,
    selected: Option<usize>,
) -> io::Result<()> {
    queue!(output, style::SetAttribute(style::Attribute::Reset))?;
    apply(output, cell, selected)?;
    if let Some(Target::Web(url)) = cell.link.map(|i| &document.links[i]) {
        let url: String = url.chars().filter(|c| !c.is_control()).collect();
        write!(output, "\x1b]8;;{url}\x1b\\{}\x1b]8;;\x1b\\", cell.text)
    } else {
        write!(output, "{}", cell.text)
    }
}

fn apply(output: &mut impl Write, cell: &Cell, selected: Option<usize>) -> io::Result<()> {
    let (color, attributes) = appearance(cell, selected);
    queue!(output, style::SetForegroundColor(color))?;
    for attribute in attributes {
        queue!(output, style::SetAttribute(*attribute))?;
    }
    Ok(())
}

type Look = (style::Color, &'static [style::Attribute]);

const LOOKS: [Look; 11] = [
    (TEXT, &[]),
    (rgb(97, 175, 239), &[Bold, Underlined]),
    (rgb(224, 108, 117), &[Bold]),
    (rgb(229, 192, 123), &[Bold]),
    (rgb(152, 195, 121), &[Bold]),
    (rgb(255, 255, 255), &[Bold]),
    (rgb(198, 120, 221), &[Italic]),
    (rgb(152, 195, 121), &[]),
    (DIM, &[Italic]),
    (rgb(209, 154, 102), &[Bold]),
    (rgb(209, 154, 102), &[]),
];

fn appearance(cell: &Cell, selected: Option<usize>) -> Look {
    match cell.link {
        Some(link) if Some(link) == selected => (rgb(229, 192, 123), &[Bold, Reverse]),
        Some(_) => (rgb(86, 182, 194), &[Underlined]),
        None => LOOKS[cell.style as usize],
    }
}

const fn rgb(r: u8, g: u8, b: u8) -> style::Color {
    style::Color::Rgb { r, g, b }
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
