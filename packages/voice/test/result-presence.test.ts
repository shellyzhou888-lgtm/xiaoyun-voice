import test from 'node:test';
import assert from 'node:assert/strict';
import type {ResultCard} from '@xiaoyun/protocol';
import {reconcileCardPresence} from '../src/ui/motion';

const card=(taskId:string):ResultCard=>({taskId,sessionId:'session',title:taskId,transcript:taskId,pinned:false,speaking:false,status:'succeeded'});

test('new result order takes effect while old cards finish their exit animation',()=>{
  const previous=['A','B','C'].map(id=>({card:card(id),exiting:false}));
  const reordered=reconcileCardPresence(previous,[card('C'),card('A'),card('B')]);
  assert.deepEqual(reordered.map(entry=>entry.card.taskId),['C','A','B']);
  const replaced=reconcileCardPresence(reordered,[card('B'),card('C'),card('D')]);
  assert.deepEqual(replaced.filter(entry=>!entry.exiting).map(entry=>entry.card.taskId),['B','C','D']);
  assert.deepEqual(replaced.filter(entry=>entry.exiting).map(entry=>entry.card.taskId),['A']);
  const restored=reconcileCardPresence(replaced,[card('C'),card('A'),card('D')]);
  assert.deepEqual(restored.filter(entry=>!entry.exiting).map(entry=>entry.card.taskId),['C','A','D']);
  assert.equal(restored.filter(entry=>entry.card.taskId==='A').length,1);
});
