import test from 'node:test';
import assert from 'node:assert/strict';
import { fauxAssistantMessage } from '@earendil-works/pi-ai';
import { assistantWarnings } from '../src/tui.js';

test('cutoff and malformed tool arguments remain visible without expanding tools',()=>{
  const message=fauxAssistantMessage('Writing a file');
  message.stopReason='length';
  message.content.push({type:'toolCall',id:'unfinished',name:'write',arguments:{},argumentsError:'Unterminated string in JSON\n\nReceived arguments:\nprivate file contents'});
  const warnings=assistantWarnings(message).join('\n');
  assert.match(warnings,/Output token limit reached/);
  assert.match(warnings,/write was not executed.*Unterminated string/);
  assert.doesNotMatch(warnings,/private file contents/);
});

test('cancellation and provider errors are reported distinctly',()=>{
  const message=fauxAssistantMessage('Partial response');
  message.stopReason='aborted';
  assert.match(assistantWarnings(message).join('\n'),/Generation cancelled/);
  message.stopReason='error';message.errorMessage='Provider connection failed';
  assert.deepEqual(assistantWarnings(message),['Provider connection failed']);
});

test('completed responses do not show a warning',()=>{
  assert.deepEqual(assistantWarnings(fauxAssistantMessage('Complete')),[]);
});
