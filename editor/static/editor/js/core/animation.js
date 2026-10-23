// Playback order of the animation, honoring tags (direction and repeat count).

// Frame indices of one tag: `loop` true means the list repeats forever (repeat = 0); otherwise it is the whole
// finite sequence (repeat passes; in ping-pong each pass is one sweep and the ends are not doubled).
export function tagSequence(from, to, direction = 'forward', repeat = 0) {
  const forward = [];
  for (let i = from; i <= to; i++) forward.push(i);
  const backward = [...forward].reverse();
  if (repeat > 0) {
    const out = [];
    for (let pass = 0; pass < repeat; pass++) {
      if (direction === 'reverse') out.push(...backward);
      else if (direction === 'pingpong') {
        const sweep = pass % 2 === 0 ? forward : backward;
        out.push(...(pass === 0 ? sweep : sweep.slice(1)));
      } else out.push(...forward);
    }
    return { frames: out, loop: false };
  }
  if (direction === 'reverse') return { frames: backward, loop: true };
  if (direction === 'pingpong') return { frames: from === to ? forward : [...forward, ...backward.slice(1, -1)], loop: true };
  return { frames: forward, loop: true };
}

// Sequence played from `frameIndex`: inside the innermost tag that contains it, or all the frames in a loop.
export function playbackSequence(doc, frameIndex) {
  const tag = doc.tagAt ? doc.tagAt(frameIndex) : null;
  if (!tag) return { ...tagSequence(0, doc.frames.length - 1), tag: null };
  return { ...tagSequence(doc.frameIndex(tag.from), doc.frameIndex(tag.to), tag.direction, tag.repeat), tag };
}

// Iterator used by the editor: next(frame) gives the next frame index, or -1 when a finite tag is over.
export class Playback {
  constructor(doc, frameIndex) {
    const { frames, loop, tag } = playbackSequence(doc, frameIndex);
    this.frames = frames;
    this.loop = loop;
    this.tag = tag;
    const at = frames.indexOf(frameIndex);
    this.position = at < 0 ? -1 : at;
  }

  next() {
    this.position++;
    if (this.position >= this.frames.length) {
      if (!this.loop) return -1;
      this.position = 0;
    }
    return this.frames[this.position];
  }
}
