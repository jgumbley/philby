import {appendFileSync, writeFileSync} from 'node:fs';

const args = process.argv.slice(2);
appendFileSync(process.env.GOG_TEST_LOG, JSON.stringify(args) + '\n');
const positional = [];
for (let i = 0; i < args.length; i++) {
  if (['--account', '--client', '--color'].includes(args[i])) i++;
  else if (!['--json', '--json=false', '--readonly', '--no-input', '--plain', '--plain=false'].includes(args[i])) positional.push(args[i]);
}
const command = positional.slice(0, 2).join(' ');
const option = name => {
  const index = args.indexOf(name);
  return index < 0 ? undefined : args[index + 1];
};
const plainMode = !args.includes('--plain=false') && (args.includes('--plain') || process.env.GOG_PLAIN === '1');
const jsonMode = !args.includes('--json=false') && (args.includes('--json') || process.env.GOG_JSON === '1');
const json = value => process.stdout.write(plainMode ? 'plain output\n' : JSON.stringify(value) + '\n');
if ((option('--client') || process.env.GOG_CLIENT || 'default') !== 'default') {
  process.stderr.write('No configured account for selected OAuth client\n');
  process.exit(8);
}
if (process.env.GOG_TEST_FAILURE && command.startsWith(process.env.GOG_TEST_FAILURE)) {
  process.stderr.write('Google request rejected: permission denied\n');
  process.exit(7);
}
if (process.env.GOG_TEST_MALFORMED && command.startsWith(process.env.GOG_TEST_MALFORMED)) {
  process.stdout.write('{malformed response\n');
  process.exit(0);
}
if (args.includes('--version') || positional[0] === 'version') {
  process.stdout.write('gog 9.99.0\n');
} else if (command === 'auth list') {
  json({accounts: [{email: 'reader@example.com', client: 'default', auth: 'oauth', services: ['chat', 'drive', 'docs', 'sheets', 'slides']}, {email: 'other@example.com', client: 'default', auth: 'oauth', services: ['gmail']}]});
} else if (command === 'auth status') {
  json({account: {email: 'reader@example.com'}, keyring: {backend: 'test'}});
} else if (command === 'docs cat') {
  const text = process.env.GOG_TEST_TEXT || `Body for ${positional[2]}\n`;
  process.stdout.write(jsonMode ? JSON.stringify({text}) + '\n' : text);
} else if (command === 'sheets get') {
  json({range: positional[3], values: [['Heading', 'Value'], ['One', process.env.GOG_TEST_TEXT || 'Two']]});
} else if (command === 'sheets export') {
  writeFileSync(option('--out'), 'Heading,Value\nOne,Two\n');
  json({path: option('--out')});
} else if (command === 'slides list-slides') {
  json({presentationId: positional[2], title: 'Example deck', slideCount: 2, slides: [{number: 1, objectId: 'slide_one', isSkipped: false}, {number: 2, objectId: 'slide_two', isSkipped: false}]});
} else if (command === 'slides read-slide') {
  json({presentationId: positional[2], slideNumber: positional[3] === 'slide_one' ? 1 : 2, slideObjectId: positional[3], notes: `Notes for ${positional[3]}`, textElements: [{objectId: 'text', text: process.env.GOG_TEST_TEXT || `Text for ${positional[3]}`}], images: [], tables: []});
} else if (command === 'drive get') {
  const types = {docId: 'application/vnd.google-apps.document', sheetId: 'application/vnd.google-apps.spreadsheet', slidesId: 'application/vnd.google-apps.presentation'};
  json({file: {id: positional[2], name: 'Example file', mimeType: types[positional[2]] || 'application/pdf'}});
} else if (command === 'drive download') {
  const path = option('--out') + (process.env.GOG_TEST_EXTENSION || '');
  writeFileSync(path, Buffer.from([0, 255, 128, 10, 42]));
  json({path, size: 5});
} else if (command === 'chat spaces') {
  json({spaces: [{resource: 'spaces/team', name: 'Team', type: 'SPACE'}, {resource: 'spaces/direct', name: 'Direct', type: 'DIRECT_MESSAGE'}, {resource: 'spaces/group', name: 'Group', type: 'GROUP_CHAT'}], nextPageToken: ''});
} else if (command === 'chat messages') {
  const space = positional[3];
  const messages = [
    {resource: `${space}/messages/new`, text: 'New message', createTime: '2026-02-03T12:00:00Z', thread: `${space}/threads/new`},
    {resource: `${space}/messages/old`, text: 'Old message', createTime: '2026-01-01T12:00:00Z', thread: `${space}/threads/old`},
    {resource: `${space}/messages/middle`, text: 'Middle message', createTime: '2026-02-02T12:00:00Z', thread: `${space}/threads/new`},
  ];
  json({messages: option('--max') === '1' ? messages.slice(0, 1) : messages, nextPageToken: ''});
} else {
  process.stderr.write(`Unexpected fake gog command: ${JSON.stringify(args)}\n`);
  process.exitCode = 2;
}
