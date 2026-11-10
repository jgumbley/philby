export type ModelReference = {provider:string;modelId:string};
export function modelReference(reference:string|undefined):ModelReference {
  if(!reference || !/^[^/\s]+\/\S+$/.test(reference)) throw Error('Model reference must be provider/model-id; set DEFAULT_MODEL in .env');
  const slash=reference.indexOf('/');
  return {provider:reference.slice(0,slash),modelId:reference.slice(slash+1)};
}
