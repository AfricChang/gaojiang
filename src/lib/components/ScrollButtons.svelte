<script lang="ts">
    import { onMount } from "svelte";
    import { globalState } from "@gaojiang/ui";

    let scrollEl: HTMLElement | null = null;
    let showTop = $state(false);
    let showBottom = $state(true);
    let visible = $state(false);
    let cleanup: (() => void) | null = null;

    function findScrollEl(): HTMLElement | null {
        const wenyan = document.getElementById("wenyan");
        if (wenyan) {
            const c = wenyan.closest(".scroll-container");
            if (c) return c as HTMLElement;
        }
        const cm = document.querySelector(".cm-scroller");
        if (cm) return cm as HTMLElement;
        return null;
    }

    function updateState() {
        const el = scrollEl;
        if (!el) {
            visible = false;
            return;
        }
        const scrollTop = el.scrollTop;
        const scrollHeight = el.scrollHeight;
        const clientHeight = el.clientHeight;
        showTop = scrollTop > 1;
        showBottom = scrollTop + clientHeight < scrollHeight - 1;
        visible = true;
    }

    function bind() {
        if (cleanup) {
            cleanup();
            cleanup = null;
        }
        scrollEl = findScrollEl();
        if (!scrollEl) {
            visible = false;
            return;
        }
        const onScroll = () => updateState();
        scrollEl.addEventListener("scroll", onScroll, { passive: true });
        updateState();
        cleanup = () => scrollEl?.removeEventListener("scroll", onScroll);
    }

    function scrollToTop() {
        scrollEl?.scrollTo({ top: 0, behavior: "smooth" });
    }

    function scrollToBottom() {
        if (scrollEl) {
            scrollEl.scrollTo({ top: scrollEl.scrollHeight, behavior: "smooth" });
        }
    }

    // 跟踪视图模式 / 主题编辑模式变化，重新绑定滚动容器
    $effect(() => {
        // 建立对 viewMode 和 themeEditMode 的响应式依赖
        globalState.getViewMode();
        globalState.getThemeEditMode();
        // 异步等待 DOM 更新后重新绑定
        queueMicrotask(bind);
    });

    onMount(() => {
        // 初次绑定：预览渲染较慢，轮询若干次直到找到容器
        let attempts = 0;
        const maxAttempts = 40;
        const timer = setInterval(() => {
            attempts++;
            const el = findScrollEl();
            if (el || attempts >= maxAttempts) {
                clearInterval(timer);
                bind();
            }
        }, 200);
        return () => {
            clearInterval(timer);
            cleanup?.();
        };
    });
</script>

{#if visible}
    <div class="pointer-events-none absolute bottom-4 right-4 z-40 flex flex-col gap-2">
        <button
            class="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 shadow-md transition hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            class:opacity-0={!showTop}
            class:pointer-events-none={!showTop}
            onclick={scrollToTop}
            aria-label="滚动到顶部"
        >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 3.5L3 8.5l1 1L7 6.5V12.5h2V6.5l3 3 1-1z" fill="currentColor" />
            </svg>
        </button>
        <button
            class="pointer-events-auto flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 bg-white text-gray-600 shadow-md transition hover:bg-gray-100 dark:border-gray-600 dark:bg-gray-800 dark:text-gray-300 dark:hover:bg-gray-700"
            class:opacity-0={!showBottom}
            class:pointer-events-none={!showBottom}
            onclick={scrollToBottom}
            aria-label="滚动到底部"
        >
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path d="M8 12.5L13 7.5l-1-1L9 9.5V3.5H7v6L4 6.5l-1 1z" fill="currentColor" />
            </svg>
        </button>
    </div>
{/if}

<style>
    button {
        transition: opacity 0.2s ease, background-color 0.15s ease;
    }
</style>
