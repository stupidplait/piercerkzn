"use client";

import dynamic from "next/dynamic";

export const ScrollJewelClient = dynamic(() => import("./ScrollJewel").then((m) => m.ScrollJewel), {
    ssr: false,
    loading: () => null,
});
