<script lang="ts">
    import {
        PlatformButtons,
        Win32WindowButtons,
        WenYanButton,
        MacWindowButtons,
        FileSidebarButton,
        ViewModeButtons,
        ColorModeToggle,
    } from "@wenyan-md/ui";
    import { getCurrentWindow } from "@tauri-apps/api/window";
    import { type } from "@tauri-apps/plugin-os";
    import { onMount } from "svelte";
    import { appState } from "$lib/appState.svelte";

    let { showMoreMenu }: { showMoreMenu: () => void } = $props();
    // 可能的值: 'windows', 'macos', 'linux', 'android', 'ios'
    let currentOs = $state<string | null>(null);

    onMount(async () => {
        currentOs = type();
    });

    function minimizeWindow() {
        const window = getCurrentWindow();
        window.minimize();
    }

    function maximizeWindow() {
        const window = getCurrentWindow();
        window.maximize();
    }

    function closeWindow() {
        const window = getCurrentWindow();
        window.close();
    }
</script>

<div data-tauri-drag-region class="relative h-7.5 flex justify-between items-center bg-gray-200 dark:bg-gray-700">
    <!-- 居中显示的当前文档标题 -->
    <div class="pointer-events-none absolute inset-0 flex items-center justify-center overflow-hidden px-44">
        {#if appState.currentDocumentName}
            <span
                class="max-w-full truncate text-xs text-gray-500 select-none dark:text-gray-300"
                title={appState.currentDocumentPath ?? appState.currentDocumentName}
            >
                {appState.currentDocumentName}
            </span>
        {:else}
            <span class="text-xs text-gray-400 select-none dark:text-gray-500">未命名文档</span>
        {/if}
    </div>
    <div class="flex flex-row gap-4 justify-center items-center px-4">
        {#if currentOs === "macos"}
            <MacWindowButtons {minimizeWindow} {maximizeWindow} {closeWindow} class="mr-2" />
            <FileSidebarButton />
            <span class="text-xs font-bold select-none">文颜</span>
            <ViewModeButtons />
        {:else}
            <WenYanButton w="20px" />
            <span class="text-xs font-bold select-none">文颜</span>
            <FileSidebarButton />
            <ViewModeButtons />
        {/if}
    </div>
    <div class="flex gap-4">
        <PlatformButtons />
        <ColorModeToggle />
        <button
            class="inline-flex h-7.5 w-7.5 cursor-pointer items-center justify-center border-none bg-gray-200 hover:bg-white dark:bg-gray-700 transition-colors"
            onclick={showMoreMenu}
            aria-label="showMoreMenu"
        >
            <svg width="16px" height="16px" viewBox="0 0 48 48" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
                <circle cx="24" cy="12" r="3" fill="#currentColor" />
                <circle cx="24" cy="24" r="3" fill="#currentColor" />
                <circle cx="24" cy="35" r="3" fill="#currentColor" />
            </svg>
        </button>
        {#if currentOs !== "macos"}
            <Win32WindowButtons {minimizeWindow} {maximizeWindow} {closeWindow} />
        {/if}
    </div>
</div>
