<!-- apps/kimi-web/src/components/FileTreeNode.vue -->
<!-- Recursive tree node for the sidebar file tree. Renders a directory
     (expandable, with children loaded on click) or a file (click to preview). -->
<script setup lang="ts">
import type { FsEntry } from '../api/types';
import type { IconName } from '../lib/icons';
import Icon from './ui/Icon.vue';

defineOptions({ name: 'FileTreeNode' });

const props = defineProps<{
  entry: FsEntry;
  depth: number;
  expandedDirs: Record<string, FsEntry[]>;
  loadingDirs: Set<string>;
  getSortedChildren: (dirPath: string) => FsEntry[];
  fileIcon: (entry: FsEntry) => IconName;
}>();

const emit = defineEmits<{
  toggleDir: [entry: FsEntry];
  openFile: [entry: FsEntry];
}>();

function isExpanded(path: string): boolean {
  return path in props.expandedDirs;
}

function isLoading(path: string): boolean {
  return props.loadingDirs.has(path);
}

function onClick(): void {
  if (props.entry.kind === 'directory') {
    emit('toggleDir', props.entry);
  } else {
    emit('openFile', props.entry);
  }
}
</script>

<template>
  <div class="ft-node">
    <div
      class="ft-row"
      :class="{ 'ft-row--dir': entry.kind === 'directory' }"
      :style="{ paddingLeft: (depth * 14 + 8) + 'px' }"
      @click="onClick"
    >
      <!-- Directory chevron / loading spinner -->
      <span v-if="entry.kind === 'directory'" class="ft-chevron-cell">
        <span v-if="isLoading(entry.path)" class="ft-spinner" />
        <Icon
          v-else
          :name="isExpanded(entry.path) ? 'chevron-down' : 'chevron-right'"
          size="sm"
          class="ft-chevron-icon"
        />
      </span>
      <span v-else class="ft-chevron-cell ft-chevron-cell--file" />
      <!-- File/folder icon -->
      <Icon :name="fileIcon(entry)" size="sm" class="ft-entry-icon" />
      <!-- Name -->
      <span class="ft-name">{{ entry.name }}</span>
    </div>
    <!-- Children (recursive) -->
    <div v-if="entry.kind === 'directory' && isExpanded(entry.path)">
      <FileTreeNode
        v-for="child in getSortedChildren(entry.path)"
        :key="child.path"
        :entry="child"
        :depth="depth + 1"
        :expanded-dirs="expandedDirs"
        :loading-dirs="loadingDirs"
        :get-sorted-children="getSortedChildren"
        :file-icon="fileIcon"
        @toggle-dir="(e) => emit('toggleDir', e)"
        @open-file="(e) => emit('openFile', e)"
      />
    </div>
  </div>
</template>

<style scoped>
.ft-node {
  user-select: none;
}
.ft-row {
  display: flex;
  align-items: center;
  height: 24px;
  gap: 4px;
  padding-right: var(--space-2);
  border-radius: 4px;
  cursor: pointer;
  color: var(--color-text);
  font-size: 12px;
}
.ft-row:hover {
  background: var(--sb-hover);
}
.ft-chevron-cell {
  width: 14px;
  height: 14px;
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}
.ft-chevron-cell--file {
  visibility: hidden;
}
.ft-chevron-icon {
  color: var(--color-text-muted);
  transition: transform 0.15s ease;
}
.ft-spinner {
  width: 10px;
  height: 10px;
  border: 1.5px solid var(--color-text-faint);
  border-top-color: var(--color-accent);
  border-radius: 50%;
  animation: ft-spin 0.6s linear infinite;
}
@keyframes ft-spin {
  to { transform: rotate(360deg); }
}
.ft-entry-icon {
  flex: none;
  color: var(--color-text-muted);
}
.ft-row--dir .ft-entry-icon {
  color: var(--color-accent);
}
.ft-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 24px;
}
</style>
