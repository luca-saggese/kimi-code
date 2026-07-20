<!-- apps/kimi-web/src/components/ServerAuthDialog.vue -->
<!-- Token or Username+Password prompt shown when the Web UI needs a
     server credential. Supports both Bearer tokens (server token /
     KIMI_CODE_PASSWORD) and Basic auth (multi-user via users.json). -->
<script setup lang="ts">
import { nextTick, onMounted, ref } from 'vue';
import { setCredential, setUserPass } from '../api/daemon/serverAuth';
import Button from './ui/Button.vue';
import Input from './ui/Input.vue';
import Switch from './ui/Switch.vue';

const mode = ref<'token' | 'basic'>('token');
const token = ref('');
const username = ref('');
const password = ref('');
const tokenRef = ref<InstanceType<typeof Input> | null>(null);
const usernameRef = ref<InstanceType<typeof Input> | null>(null);
const submitting = ref(false);

onMounted(() => {
  void nextTick(() => tokenRef.value?.focus());
});

function submit(): void {
  if (submitting.value) return;
  if (mode.value === 'token') {
    const value = token.value;
    if (!value) return;
    submitting.value = true;
    setCredential(value);
  } else {
    const u = username.value;
    const p = password.value;
    if (!u || !p) return;
    submitting.value = true;
    setUserPass(u, p);
  }
  window.location.reload();
}

function onKeydown(e: KeyboardEvent): void {
  if (e.key === 'Enter') {
    e.preventDefault();
    submit();
  }
}

function switchMode(): void {
  mode.value = mode.value === 'token' ? 'basic' : 'token';
  void nextTick(() => {
    if (mode.value === 'token') tokenRef.value?.focus();
    else usernameRef.value?.focus();
  });
}
</script>

<template>
  <div class="server-auth-overlay" role="dialog" aria-modal="true" aria-labelledby="server-auth-title">
    <div class="server-auth-card">
      <div class="server-auth-head">
        <h1 id="server-auth-title" class="server-auth-title">
          {{ mode === 'token' ? 'Server token required' : 'Sign in' }}
        </h1>
        <p class="server-auth-hint">
          <template v-if="mode === 'token'">
            Enter the server token or <code>KIMI_CODE_PASSWORD</code>.
            <button type="button" class="mode-link" @click="switchMode">Sign in with username &amp; password instead</button>
          </template>
          <template v-else>
            Enter your username and password.
            <button type="button" class="mode-link" @click="switchMode">Use a server token instead</button>
          </template>
        </p>
      </div>
      <div class="server-auth-body">
        <template v-if="mode === 'token'">
          <Input
            ref="tokenRef"
            v-model="token"
            type="password"
            autocomplete="current-password"
            placeholder="Token or password"
            :disabled="submitting"
            @keydown="onKeydown"
          />
        </template>
        <template v-else>
          <div class="basic-fields">
            <Input
              ref="usernameRef"
              v-model="username"
              type="text"
              autocomplete="username"
              placeholder="Username"
              :disabled="submitting"
              @keydown="onKeydown"
            />
            <Input
              v-model="password"
              type="password"
              autocomplete="current-password"
              placeholder="Password"
              :disabled="submitting"
              @keydown="onKeydown"
            />
          </div>
        </template>
      </div>
      <div class="server-auth-foot">
        <Button
          variant="primary"
          :disabled="(mode === 'token' ? !token : !username || !password) || submitting"
          :loading="submitting"
          @click="submit"
        >
          {{ submitting ? 'Connecting…' : (mode === 'token' ? 'Connect' : 'Sign in') }}
        </Button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.server-auth-overlay {
  position: fixed;
  inset: 0;
  z-index: var(--z-max);
  display: flex;
  align-items: center;
  justify-content: center;
  background: color-mix(in srgb, var(--color-bg) 70%, transparent);
}

.server-auth-card {
  width: 480px;
  max-width: calc(100vw - 48px);
  background: var(--color-surface-raised);
  border: 1px solid var(--color-line);
  border-radius: var(--radius-xl);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  color: var(--color-text);
  font-family: var(--font-ui);
}

.server-auth-head {
  display: flex;
  flex-direction: column;
  padding: 20px 22px 14px;
}

.server-auth-title {
  margin: 0;
  font-size: var(--text-lg);
  font-weight: var(--weight-medium);
  letter-spacing: -0.01em;
  color: var(--color-text);
}

.server-auth-hint {
  margin: 4px 0 0;
  font-size: var(--text-base);
  line-height: var(--leading-normal);
  color: var(--color-text-muted);
}

.server-auth-hint code {
  padding: 1px 5px;
  font-family: var(--font-mono);
  font-size: var(--text-xs);
  background: var(--color-surface-sunken);
  border-radius: var(--radius-xs);
}

.mode-link {
  background: none;
  border: none;
  padding: 0;
  color: var(--color-accent);
  cursor: pointer;
  font-size: inherit;
  font-family: inherit;
  text-decoration: underline;
  text-underline-offset: 2px;
}

.mode-link:hover {
  color: var(--color-accent-hover);
}

.server-auth-body {
  padding: 4px 22px 18px;
}

.basic-fields {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.server-auth-foot {
  display: flex;
  justify-content: flex-end;
  gap: 10px;
  padding: 14px 22px 20px;
}
</style>
