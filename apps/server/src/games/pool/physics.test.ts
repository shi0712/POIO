import assert from 'node:assert/strict';
import test from 'node:test';
import { rackPoolBalls,simulatePoolShot,validCuePosition } from './physics.js';

test('pool rack is complete and deterministic',()=>{
  const balls=rackPoolBalls();
  assert.equal(balls.length,16);
  assert.deepEqual(balls.map(ball=>ball.number).sort((a,b)=>a-b),Array.from({length:16},(_,index)=>index));
  assert.equal(balls.find(ball=>ball.number===8)?.x,692);
});

test('pool server simulation creates frames and conserves every ball',()=>{
  const source=rackPoolBalls();
  const result=simulatePoolShot(source,0,1);
  assert.ok(result.frames.length>2);
  assert.equal(result.balls.length,16);
  assert.equal(new Set(result.balls.map(ball=>ball.number)).size,16);
  assert.ok(result.firstContact!==undefined);
});

test('cue ball placement rejects rails and overlaps',()=>{
  const balls=rackPoolBalls();
  assert.equal(validCuePosition(balls,500,250),true);
  assert.equal(validCuePosition(balls,10,10),false);
  assert.equal(validCuePosition(balls,650,250),false);
});
