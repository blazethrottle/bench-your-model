// Checks the video inspectors on files made here: a correct edit scores 100 and an untouched folder scores 0.
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { videoEditTask, videoMakeTask, webTask, writingTask } from '../lib/tasks-extra.mjs';
const d = mkdtempSync(join(tmpdir(), 'bm-vid-'));
const src = videoEditTask.files['source.mp4']; console.log('source bytes', src.length);
writeFileSync(join(d, 'source.mp4'), src);
console.log('empty', (await videoEditTask.score('', { '__inspect.json': JSON.stringify(await videoEditTask.inspect(d)) })).detail);
spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-t', '6', '-i', join(d, 'source.mp4'), '-vf', 'scale=1280:720,fps=24', '-an', '-c:v', 'libx264', join(d, 'out.mp4')]);
spawnSync('ffmpeg', ['-v', 'error', '-y', '-ss', '3', '-t', '6', '-i', join(d, 'source.mp4'), '-vn', join(d, 'audio.mp3')]);
const e = await videoEditTask.inspect(d); console.log(JSON.stringify(e));
console.log('good edit', await videoEditTask.score('', { '__inspect.json': JSON.stringify(e) }));
spawnSync('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=10', '-f', 'lavfi', '-i', 'sine=frequency=300:duration=10', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', join(d, 'intro.mp4')]);
const m = await videoMakeTask.inspect(d); console.log(JSON.stringify({ ...m, stills: m.stills.map((s) => s && s.length) }));
console.log('test pattern', await videoMakeTask.score('', { '__inspect.json': JSON.stringify(m) }));
console.log('web null', await webTask.score('```json\n{"npm_vite":"1.0.0"}\n```'));
console.log('writing junk', await writingTask.score('짧은 글'));
