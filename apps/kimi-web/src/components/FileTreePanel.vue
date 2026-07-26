<!-- apps/kimi-web/src/components/FileTreePanel.vue -->
<!-- Collapsible sidebar panel showing a tree of files in the current working
     directory. Mirrors the WORKSPACES section style. -->
<script setup lang="ts">
import { ref, watch } from 'vue';
import { useI18n } from 'vue-i18n';
import type { FsEntry } from '../api/types';
import type { IconName } from '../lib/icons';
import FileTreeNode from './FileTreeNode.vue';
import Icon from './ui/Icon.vue';
import IconButton from './ui/IconButton.vue';

defineOptions({ name: 'FileTreePanel' });

const props = defineProps<{
  listDir: (path: string) => Promise<FsEntry[]>;
  activeSessionId: string | null;
}>();

const emit = defineEmits<{
  openFile: [path: string];
}>();

const { t } = useI18n();

const collapsed = ref(false);
const roots = ref<FsEntry[]>([]);
const loading = ref(false);
const error = ref<string | null>(null);
const expandedDirs = ref<Record<string, FsEntry[]>>({});
const loadingDirs = ref<Set<string>>(new Set());

async function loadRoot(): Promise<void> {
  loading.value = true;
  error.value = null;
  console.log('[FileTreePanel] loadRoot: listDir function =', typeof props.listDir);
  try {
    console.log('[FileTreePanel] loadRoot: calling listDir("")...');
    const result = await props.listDir('');
    console.log('[FileTreePanel] loadRoot: result =', result);
    console.log('[FileTreePanel] loadRoot: result.length =', result?.length);
    roots.value = result;
  } catch (err) {
    console.error('[FileTreePanel] loadRoot: error =', err);
    error.value = t('fileTree.loadError');
    roots.value = [];
  } finally {
    loading.value = false;
  }
}
// Reload whenever the active session changes to a non-null value.
watch(
  () => props.activeSessionId,
  (sid) => {
    if (sid) loadRoot();
    else {
      roots.value = [];
      error.value = null;
      expandedDirs.value = {};
    }
  },
  { immediate: true },
);

async function toggleDir(entry: FsEntry): Promise<void> {
  if (entry.kind !== 'directory') return;
  if (entry.path in expandedDirs.value) {
    const next = { ...expandedDirs.value };
    delete next[entry.path];
    expandedDirs.value = next;
    return;
  }
  loadingDirs.value = new Set([...loadingDirs.value, entry.path]);
  try {
    const children = await props.listDir(entry.path);
    expandedDirs.value = { ...expandedDirs.value, [entry.path]: children };
  } catch {
    /* silently stay collapsed */
  } finally {
    const next = new Set(loadingDirs.value);
    next.delete(entry.path);
    loadingDirs.value = next;
  }
}

function getSortedChildren(dirPath: string): FsEntry[] {
  const children = expandedDirs.value[dirPath];
  if (!children) return [];
  return [...children].sort((a, b) => {
    if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

const KNOWN_EXTENSIONS: Record<string, IconName> = {
  '.yaml': 'glob', '.yml': 'glob',
  '.md': 'file-text', '.mdx': 'file-text',
  '.json': 'glob',
  '.js': 'code', '.mjs': 'code', '.cjs': 'code',
  '.ts': 'code', '.tsx': 'code', '.jsx': 'code',
  '.vue': 'code', '.svelte': 'code',
  '.css': 'code', '.scss': 'code', '.less': 'code',
  '.html': 'code', '.htm': 'code',
  '.svg': 'image', '.png': 'image', '.jpg': 'image',
  '.jpeg': 'image', '.gif': 'image', '.webp': 'image', '.ico': 'image',
  '.txt': 'file-text', '.log': 'file-text', '.csv': 'file-text', '.env': 'file-text',
  '.toml': 'settings', '.lock': 'settings',
  '.gitignore': 'settings', '.dockerignore': 'settings',
  '.sh': 'terminal', '.bash': 'terminal', '.zsh': 'terminal', '.fish': 'terminal',
  '.py': 'code', '.rb': 'code', '.go': 'code', '.rs': 'code',
  '.java': 'code', '.kt': 'code', '.swift': 'code',
  '.c': 'code', '.h': 'code', '.cpp': 'code', '.hpp': 'code',
};

function fileExtension(path: string): string {
  const i = path.lastIndexOf('.');
  if (i <= 0 || i === path.length - 1) return '';
  if (path.lastIndexOf('/') === i - 1) return path.slice(i);
  return path.slice(i);
}

function fileIcon(entry: FsEntry): IconName {
  if (entry.kind === 'directory') {
    return entry.path in expandedDirs.value ? 'folder' : 'folder-closed';
  }
  const ext = fileExtension(entry.name).toLowerCase();
  return KNOWN_EXTENSIONS[ext] ?? 'file';
}

function onOpenFile(entry: FsEntry): void {
  if (entry.kind === 'file') emit('openFile', entry.path);
}

function toggleCollapse(): void {
  collapsed.value = !collapsed.value;
}
</script>

<template>
  <div class="ft-panel">
    <div class="side-section-label">
      <span class="side-section-title">{{ t('fileTree.title') }}</span>
      <div class="side-section-actions">
        <IconButton
          class="side-section-toggle"
          size="sm"
          :label="collapsed ? t('fileTree.expand') : t('fileTree.collapse')"
          @click.stop="toggleCollapse"
        >
          <Icon v-if="collapsed" name="expand" />
          <Icon v-else name="collapse" />
        </IconButton>
      </div>
    </div>

    <div class="ft-body" :class="{ 'ft-body--collapsed': collapsed }" :inert="collapsed || undefined">
      <div v-if="loading" class="ft-empty">{{ t('fileTree.loading') }}</div>
      <div v-else-if="error" class="ft-empty ft-empty--error">{{ error }}</div>
      <div v-else-if="roots.length === 0" class="ft-empty">{{ t('fileTree.empty') }}</div>
      <template v-else>
        <FileTreeNode
          v-for="entry in [...roots].sort((a, b) => {
            if (a.kind !== b.kind) return a.kind === 'directory' ? -1 : 1;
            return a.name.localeCompare(b.name);
          })"
          :key="entry.path"
          :entry="entry"
          :depth="0"
          :expanded-dirs="expandedDirs"
          :loading-dirs="loadingDirs"
          :get-sorted-children="getSortedChildren"
          :file-icon="fileIcon"
          @toggle-dir="toggleDir"
          @open-file="onOpenFile"
        />
      </template>
    </div>
  </div>
</template>

<style scoped>
.ft-panel { flex: none; }
.ft-body {
  overflow-y: auto;
  overflow-x: hidden;
  max-height: 280px;
  padding-bottom: var(--space-2);
  transition: max-height var(--duration-base) var(--ease-out);
}
.ft-body--collapsed { max-height: 0; padding-bottom: 0; }
.ft-empty {
  padding: var(--space-2) var(--space-3);
  text-align: center;
  color: var(--faint);
  font-size: 11px;
  line-height: 1.5;
}
.ft-empty--error { color: var(--color-error); }
</style>
