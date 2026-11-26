import { test, beforeEach } from 'node:test'
import assert from 'node:assert/strict'
import { watchAudioContext, wakeAudioContext, markAudioInterrupted, _resetWakeAudio } from './wakeAudio.js'

function fakeContext(state = 'running') {
  const calls = []
  const listeners = {}
  const ctx = {
    state,
    calls,
    addEventListener: (type, fn) => { listeners[type] = fn },
    emit(next) { ctx.state = next; listeners.statechange?.() },
    async suspend() { calls.push('suspend'); ctx.state = 'suspended' },
    async resume() { calls.push('resume'); ctx.state = 'running' },
  }
  return ctx
}

beforeEach(() => _resetWakeAudio())

test('an unwatched context is resumed only when not running', async () => {
  const a = fakeContext('suspended')
  await wakeAudioContext(a)
  assert.deepEqual(a.calls, ['resume'])
  const b = fakeContext('running')
  await wakeAudioContext(b)
  assert.deepEqual(b.calls, [])
})

test('a healthy watched context is left alone', async () => {
  const ctx = fakeContext('running')
  watchAudioContext(ctx)
  await wakeAudioContext(ctx)
  assert.deepEqual(ctx.calls, [])
})

test("Safari's 'interrupted' state is resumed on the next wake", async () => {
  const ctx = fakeContext('running')
  watchAudioContext(ctx)
  ctx.emit('interrupted')
  await wakeAudioContext(ctx)
  assert.equal(ctx.state, 'running')
  assert.deepEqual(ctx.calls, ['resume'])
})

test('"running" after the page was hidden is restarted, not trusted', async () => {
  const ctx = fakeContext('running')
  watchAudioContext(ctx)
  markAudioInterrupted()
  await wakeAudioContext(ctx)
  assert.deepEqual(ctx.calls, ['suspend', 'resume'])
  // Once restarted it is healthy again: no second cycle.
  await wakeAudioContext(ctx)
  assert.deepEqual(ctx.calls, ['suspend', 'resume'])
})

test('a suspend the page did not ask for counts as an interruption', async () => {
  const ctx = fakeContext('running')
  watchAudioContext(ctx)
  ctx.emit('suspended')
  ctx.state = 'running' // Safari claims it came back on its own
  await wakeAudioContext(ctx)
  assert.deepEqual(ctx.calls, ['suspend', 'resume'])
})

test('wakes at the same moment share one restart', async () => {
  const ctx = fakeContext('running')
  watchAudioContext(ctx)
  markAudioInterrupted()
  await Promise.all([wakeAudioContext(ctx), wakeAudioContext(ctx), wakeAudioContext(ctx)])
  assert.deepEqual(ctx.calls, ['suspend', 'resume'])
})

test('a failed resume stays marked, so the next tap tries again', async () => {
  const ctx = fakeContext('running')
  ctx.resume = async () => { ctx.calls.push('resume') } // Safari refuses: stays suspended
  watchAudioContext(ctx)
  markAudioInterrupted()
  await wakeAudioContext(ctx)
  ctx.resume = async () => { ctx.calls.push('resume'); ctx.state = 'running' }
  await wakeAudioContext(ctx)
  assert.equal(ctx.state, 'running')
  assert.deepEqual(ctx.calls, ['suspend', 'resume', 'resume'])
})
