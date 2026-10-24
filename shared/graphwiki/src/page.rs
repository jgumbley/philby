use std::collections::{BTreeMap, BTreeSet};

use pulldown_cmark::{Event, LinkType, Options, Parser, Tag};

use crate::Result;

#[derive(Clone)]
pub struct Page {
    pub directory: &'static str,
    pub name: String,
    pub content: String,
    pub properties: BTreeMap<String, String>,
    pub references: BTreeSet<String>,
}

impl Page {
    pub fn load(path: &std::path::Path, directory: &'static str) -> Result<Self> {
        let name = path
            .file_stem()
            .and_then(|name| name.to_str())
            .ok_or_else(|| format!("Invalid page filename: {}", path.display()))?;
        Self::parse(directory, name.to_string(), crate::storage::read(path)?)
    }

    pub fn parse(directory: &'static str, name: String, content: String) -> Result<Self> {
        let properties =
            properties(&content).map_err(|error| format!("{directory}/{name}.md: {error}"))?;
        let references = page_references(&content, &properties);
        Ok(Self {
            directory,
            name,
            content,
            properties,
            references,
        })
    }

    pub fn title(&self) -> &str {
        self.property("title").unwrap_or(&self.name)
    }

    pub fn system(&self) -> bool {
        self.directory == "pages" && matches!(self.name.as_str(), "index" | "log")
    }

    pub fn journal(&self) -> bool {
        self.directory == "journals"
    }

    pub fn path(&self) -> String {
        format!("{}.md", self.key())
    }

    pub fn key(&self) -> String {
        format!("{}/{}", self.directory, self.name)
    }

    pub fn matches(&self, query: &str) -> bool {
        self.name.to_lowercase().contains(query) || self.content.to_lowercase().contains(query)
    }

    pub fn property(&self, key: &str) -> Option<&str> {
        self.properties
            .get(key)
            .map(String::as_str)
            .filter(|value| !value.trim().is_empty())
    }

    pub fn sources(&self) -> BTreeSet<String> {
        self.properties
            .get("sources")
            .map(|value| property_links(value))
            .unwrap_or_default()
    }
}

fn page_references(content: &str, properties: &BTreeMap<String, String>) -> BTreeSet<String> {
    let body = content
        .lines()
        .skip_while(|line| line.trim().is_empty())
        .skip(properties.len())
        .collect::<Vec<_>>()
        .join("\n");
    let mut references = wiki_links(&body);
    for value in properties.values() {
        references.extend(property_links(value));
    }
    references
}

fn property_links(value: &str) -> BTreeSet<String> {
    if value.starts_with('"') && value.ends_with('"') {
        return BTreeSet::new();
    }
    wiki_links(value)
}

fn properties(content: &str) -> Result<BTreeMap<String, String>> {
    let mut result = BTreeMap::new();
    for line in content.lines().skip_while(|line| line.trim().is_empty()) {
        let Some((key, value)) = line.split_once("::") else {
            break;
        };
        if key.is_empty() || key.chars().any(char::is_whitespace) {
            break;
        }
        let key = key.to_lowercase().replace('_', "-");
        if result
            .insert(key.clone(), value.trim().to_string())
            .is_some()
        {
            return Err(format!("duplicate page property: {key}"));
        }
    }
    Ok(result)
}

pub fn links(content: &str) -> Vec<(LinkType, String)> {
    Parser::new_ext(content, Options::ENABLE_WIKILINKS)
        .filter_map(|event| match event {
            Event::Start(Tag::Link {
                link_type,
                dest_url,
                ..
            }) => Some((link_type, dest_url.to_string())),
            _ => None,
        })
        .collect()
}

pub fn wiki_links(content: &str) -> BTreeSet<String> {
    links(content)
        .into_iter()
        .filter_map(|(kind, target)| {
            matches!(kind, LinkType::WikiLink { .. }).then(|| target.trim().to_lowercase())
        })
        .collect()
}
