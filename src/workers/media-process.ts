/**
 * Media post-processing worker.
 *
 * In dev (`tsx src/workers/index.ts`) a BullMQ Worker handles the
 * `media:process` queue, calling `sharp` for image variants and
 * `gltfpack` (when on PATH) for GLB optimisation. There is no Vercel
 * cron equivalent — production deployments either run `sharp` inside
 * the same serverless invocation that finalised the upload or push
 * media optimisation to the asset pipeline (Blender / CI).
 */
import "server-only";

import { processMediaJob } from "@/lib/media/process";

export { processMediaJob } from "@/lib/media/process";

export const processor = processMediaJob;
