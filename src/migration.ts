import { existsSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

export function frameText(text:string) {
  const kept:string[]=[];
  const protectedText=text.replace(/TMUX_PANE|#\{pane_[a-z_]+\}|\b(?:list-panes|select-pane|capture-pane|kill-pane|respawn-pane)\b|Pane is dead/g,value=>{kept.push(value);return `\u0000${kept.length-1}\u0000`;});
  return protectedText.replace(/PANES|PANE(?!L)|Panes|Pane(?!l)|panes|pane(?!l)/g,value=>({PANES:'FRAMES',PANE:'FRAME',Panes:'Frames',Pane:'Frame',panes:'frames',pane:'frame'})[value]!).replace(/\u0000(\d+)\u0000/g,(_,index)=>kept[Number(index)]);
}
export function migrateFrames(source:string,destination:string) {
  source=resolve(source);destination=resolve(destination);
  if(source===destination || destination.startsWith(source+'/') || source.startsWith(destination+'/')) throw Error('Migration requires separate, non-nested source and destination directories');
  if(!existsSync(source)) throw Error(`No legacy pane directory: ${source}`);
  if(existsSync(destination)) throw Error(`Migration would overwrite ${destination}; resolve the directory conflict first`);
  const edits:{path:string;content:string}[]=[];
  const markers:string[]=[];
  function inspect(directory:string) {
    for(const entry of readdirSync(join(source,directory),{withFileTypes:true})) {
      const path=join(directory,entry.name);
      if(entry.isDirectory()) {
        if(!['.state','.git','node_modules','dist'].includes(entry.name)) inspect(path);
      } else if(entry.isFile()) {
        if(entry.name==='.pane-type' && directory && !directory.includes('/')) {
          if(existsSync(join(source,directory,'.frame-type'))) throw Error(`Conflicting frame type markers in ${directory}`);
          markers.push(path);
        } else if(entry.name==='Makefile' || ['.md','.mjs','.js','.ts','.sh','.mk'].includes(extname(entry.name))) {
          const before=readFileSync(join(source,path),'utf8');
          const content=frameText(before);
          if(content!==before) edits.push({path,content});
        }
      }
    }
  }
  inspect('');
  renameSync(source,destination);
  for(const path of markers) renameSync(join(destination,path),join(destination,path.replace(/\.pane-type$/,'.frame-type')));
  for(const edit of edits) writeFileSync(join(destination,edit.path),edit.content);
  return {source,destination,markers:markers.length,editedFiles:edits.length};
}
