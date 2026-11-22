import { collapseSystemMessages, normalizeContext } from '@earendil-works/pi-ai/utils/transcript';
import { GenerationTask, hook } from '@earendil-works/pi-durable';

export const frameContext=hook(GenerationTask,{
  beforeRequest:({messages})=>collapseSystemMessages(normalizeContext({messages:[...messages]}))
});
