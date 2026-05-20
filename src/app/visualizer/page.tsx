/**
 * /visualizer page.
 *
 * Server Component shell that resolves Mini-App context once and hands
 * the boolean down to the client-side `<VisualizerShell>`. The shell
 * mounts the Telegram WebApp provider, fires the documented PostHog
 * `visualizer_opened` event, and renders the Russian-language placeholder
 * body. Future Phase 5b 3D-UI work replaces only the shell's body — the
 * page, layout, provider, theme bridge, and analytics surface are
 * untouched by Phase 5b.
 *
 * Requirements: 1.1, 1.5, 9.1, 9.2
 */
import type { Metadata } from "next";

import VisualizerShell from "@/components/visualizer/visualizer-shell";
import { isTelegramMiniApp } from "@/lib/telegram/mini-app";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
    title: "3D-примерка — PiercerKZN",
    description:
        "3D-примерка украшений студии PiercerKZN. Подберите вариант на 3D-модели и забронируйте онлайн.",
};

interface VisualizerPageProps {
    searchParams?: Promise<Record<string, string | string[] | undefined>>;
}

export default async function VisualizerPage({ searchParams }: VisualizerPageProps) {
    const params = (await searchParams) ?? {};
    const isMini = await isTelegramMiniApp(params);

    return <VisualizerShell isMini={isMini} />;
}
