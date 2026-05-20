/**
 * Development seed — populates the minimum data required to run the storefront
 * locally end-to-end (catalog, services, 3D, blog, aftercare, looks).
 *
 *   pnpm db:seed
 *
 * Safe to re-run: every section is keyed on a natural unique (handle / slug /
 * sku / etc.) and uses select-then-insert so existing rows are left intact.
 * Singletons (piercer_profile, body_model) use stable sentinel UUIDs.
 *
 * Prices are stored as integer kopecks (RUB minor unit). 120_000 == 1200 ₽.
 *
 * Requires .env.local with DATABASE_URL.
 */
import "./load-env";
import { eq, and, sql } from "drizzle-orm";
import { db } from "./index";
import {
    aftercareGuides,
    blogCategories,
    blogPosts,
    bodyModels,
    curatedLooks,
    jewelry3dModels,
    lookPieces,
    piercerProfile,
    piercerSchedule,
    piercingPoints,
    portfolioImages,
    productCategories,
    productMedia,
    productPiercingAreas,
    productVariants,
    products,
    services,
    settings,
    waiverTemplates,
} from "./schema";

// Sentinel UUIDs for singletons / stable refs.
const PIERCER_PROFILE_ID = "00000000-0000-0000-0000-000000000001";
const BODY_MODEL_HEAD_ID = "00000000-0000-0000-0000-000000000002";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
async function ensureByHandle<TVal extends { handle: string }>(
    table: { handle: { name?: string } } & any,
    values: TVal
): Promise<string> {
    const existing = await db
        .select({ id: table.id })
        .from(table)
        .where(eq(table.handle, values.handle))
        .limit(1);
    if (existing[0]?.id) return existing[0].id as string;
    const [created] = await db.insert(table).values(values).returning({ id: table.id });
    return created.id as string;
}

async function ensureBySlug<TVal extends { slug: string }>(
    table: any,
    values: TVal
): Promise<string> {
    const existing = await db
        .select({ id: table.id })
        .from(table)
        .where(eq(table.slug, values.slug))
        .limit(1);
    if (existing[0]?.id) return existing[0].id as string;
    const [created] = await db.insert(table).values(values).returning({ id: table.id });
    return created.id as string;
}

async function ensureBySku(values: typeof productVariants.$inferInsert): Promise<string> {
    if (!values.sku) throw new Error("ensureBySku requires sku");
    const existing = await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.sku, values.sku))
        .limit(1);
    if (existing[0]?.id) return existing[0].id;
    const [created] = await db
        .insert(productVariants)
        .values(values)
        .returning({ id: productVariants.id });
    return created.id;
}

// ---------------------------------------------------------------------------
// 1. Piercer profile (singleton)
// ---------------------------------------------------------------------------
async function seedPiercerProfile(): Promise<void> {
    // Collapse any duplicates from earlier seed runs to a single canonical row.
    await db.delete(piercerProfile).where(sql`${piercerProfile.id} <> ${PIERCER_PROFILE_ID}`);

    await db
        .insert(piercerProfile)
        .values({
            id: PIERCER_PROFILE_ID,
            firstName: "Владелец",
            lastName: "",
            title: "Профессиональный пирсер",
            bio: "Студия пирсинга PiercerKZN в Казани. Один мастер — одна процедура — одно украшение.",
            socialTelegram: "https://t.me/piercerkzn",
            socialInstagram: "https://instagram.com/piercer.kzn",
            ratingAverage: "0.0",
            ratingCount: 0,
        })
        .onConflictDoNothing({ target: piercerProfile.id });

    console.log("  ✓ Piercer profile (singleton)");
}

// ---------------------------------------------------------------------------
// 2. Weekly schedule (PK on day_of_week)
// ---------------------------------------------------------------------------
async function seedSchedule(): Promise<void> {
    const week = [
        { dayOfWeek: 0, isWorking: true, startTime: "10:00:00", endTime: "19:00:00" },
        { dayOfWeek: 1, isWorking: true, startTime: "10:00:00", endTime: "19:00:00" },
        { dayOfWeek: 2, isWorking: true, startTime: "10:00:00", endTime: "19:00:00" },
        { dayOfWeek: 3, isWorking: true, startTime: "10:00:00", endTime: "19:00:00" },
        { dayOfWeek: 4, isWorking: true, startTime: "10:00:00", endTime: "19:00:00" },
        { dayOfWeek: 5, isWorking: true, startTime: "10:00:00", endTime: "16:00:00" },
        { dayOfWeek: 6, isWorking: false },
    ] as const;
    for (const row of week) {
        await db
            .insert(piercerSchedule)
            .values(row)
            .onConflictDoNothing({ target: piercerSchedule.dayOfWeek });
    }
    console.log("  ✓ Weekly schedule");
}

// ---------------------------------------------------------------------------
// 3. Studio settings
// ---------------------------------------------------------------------------
async function seedSettings(): Promise<void> {
    const rows = [
        {
            key: "studio.name",
            value: { text: "PiercerKZN" },
            groupName: "studio",
            description: "Brand name",
        },
        {
            key: "studio.address",
            value: { text: "ул. Баумана 38, Казань" },
            groupName: "studio",
            description: "Physical address",
        },
        {
            key: "studio.phone",
            value: { text: "+7 (843) 000-00-00" },
            groupName: "studio",
            description: "Contact phone",
        },
        {
            key: "studio.telegram",
            value: { text: "https://t.me/piercerkzn" },
            groupName: "studio",
            description: "Telegram link",
        },
        {
            key: "studio.instagram",
            value: { text: "https://instagram.com/piercer.kzn" },
            groupName: "studio",
            description: "Instagram URL",
        },
        {
            key: "studio.founded_year",
            value: { number: 2016 },
            groupName: "studio",
            description: "Year the studio was founded",
        },
        {
            key: "reservation.hold_hours",
            value: { number: 72 },
            groupName: "reservation",
            description: "Hours a hold is valid before auto-expiry",
        },
        {
            key: "booking.slot_duration_minutes",
            value: { number: 30 },
            groupName: "booking",
            description: "Appointment slot length",
        },
        {
            key: "booking.buffer_minutes",
            value: { number: 15 },
            groupName: "booking",
            description: "Gap between slots",
        },
        {
            key: "booking.advance_days",
            value: { number: 30 },
            groupName: "booking",
            description: "How many days ahead customers can book",
        },
        {
            key: "booking.min_notice_hours",
            value: { number: 2 },
            groupName: "booking",
            description: "Minimum notice before a slot",
        },
    ];
    for (const row of rows) {
        await db.insert(settings).values(row).onConflictDoNothing({ target: settings.key });
    }
    console.log(`  ✓ Studio settings (${rows.length} keys)`);
}

// ---------------------------------------------------------------------------
// 4. Product categories
// ---------------------------------------------------------------------------
interface CategorySeed {
    handle: string;
    name: string;
    description: string;
    sortOrder: number;
}

async function seedCategories(): Promise<Record<string, string>> {
    const cats: CategorySeed[] = [
        {
            handle: "ear",
            name: "Серьги для ушей",
            description: "Украшения для всех зон уха — мочка, хеликс, трагус.",
            sortOrder: 1,
        },
        {
            handle: "nose",
            name: "Украшения для носа",
            description: "Серьги для ноздрей и септума.",
            sortOrder: 2,
        },
        {
            handle: "lip",
            name: "Украшения для губ",
            description: "Лабреты и кольца для пирсинга губ.",
            sortOrder: 3,
        },
        {
            handle: "eyebrow",
            name: "Украшения для бровей",
            description: "Штанги и кольца для пирсинга бровей.",
            sortOrder: 4,
        },
        {
            handle: "navel",
            name: "Украшения для пупка",
            description: "Бананы и штанги для пирсинга пупка.",
            sortOrder: 5,
        },
        {
            handle: "dermal",
            name: "Микродермалы",
            description: "Накожные украшения с плоской основой.",
            sortOrder: 6,
        },
    ];
    const map: Record<string, string> = {};
    for (const c of cats) {
        map[c.handle] = await ensureByHandle(productCategories, c);
    }
    console.log(`  ✓ Product categories (${cats.length})`);
    return map;
}

// ---------------------------------------------------------------------------
// 5. Products + variants + piercing-area links
// ---------------------------------------------------------------------------
interface ProductSeed {
    handle: string;
    title: string;
    description: string;
    categoryHandle: string;
    material: string;
    jewelryType: string;
    threading: string | null;
    status: "draft" | "published";
    isFeatured: boolean;
    has3dModel: boolean;
    thumbnailUrl: string | null;
    areas: string[]; // piercing_area enum strings
    variants: Array<{
        skuSuffix: string;
        title: string;
        materialFinish: string;
        gauge: string;
        lengthMm?: string;
        diameterMm?: string;
        priceRub: number; // kopecks
        inventoryQuantity: number;
        gemType?: string;
        gemColor?: string;
    }>;
}

const productSeeds: ProductSeed[] = [
    {
        handle: "titanium-stud-cz-3mm",
        title: "Титановая серьга-гвоздик с цирконом 3 мм",
        description:
            "Имплантационный титан ASTM F-136, внутренняя резьба. Универсальная серьга для лобарного и хеликс-пирсинга, гипоаллергенная.",
        categoryHandle: "ear",
        material: "titanium",
        jewelryType: "stud",
        threading: "internal",
        status: "published",
        isFeatured: true,
        has3dModel: true,
        thumbnailUrl: null,
        areas: ["ear_lobe", "ear_helix", "ear_tragus"],
        variants: [
            {
                skuSuffix: "20G-6",
                title: "20G, длина 6 мм",
                materialFinish: "polished_titanium",
                gauge: "20g",
                lengthMm: "6.0",
                priceRub: 120000,
                inventoryQuantity: 12,
                gemType: "cz",
                gemColor: "clear",
            },
            {
                skuSuffix: "18G-6",
                title: "18G, длина 6 мм",
                materialFinish: "polished_titanium",
                gauge: "18g",
                lengthMm: "6.0",
                priceRub: 130000,
                inventoryQuantity: 10,
                gemType: "cz",
                gemColor: "clear",
            },
            {
                skuSuffix: "18G-8",
                title: "18G, длина 8 мм",
                materialFinish: "polished_titanium",
                gauge: "18g",
                lengthMm: "8.0",
                priceRub: 135000,
                inventoryQuantity: 8,
                gemType: "cz",
                gemColor: "clear",
            },
        ],
    },
    {
        handle: "gold-14k-hoop-8mm",
        title: "Кольцо-сегмент 14K золото 8 мм",
        description:
            "Жёлтое золото 585 пробы, кликерный сегмент с плавным открытием. Подходит для хеликса, ноздри и септума.",
        categoryHandle: "ear",
        material: "gold_14k",
        jewelryType: "hoop",
        threading: null,
        status: "published",
        isFeatured: true,
        has3dModel: true,
        thumbnailUrl: null,
        areas: ["ear_helix", "ear_lobe", "nose_nostril", "nose_septum"],
        variants: [
            {
                skuSuffix: "18G-8",
                title: "18G, диаметр 8 мм",
                materialFinish: "yellow_gold",
                gauge: "18g",
                diameterMm: "8.0",
                priceRub: 1450000,
                inventoryQuantity: 4,
            },
            {
                skuSuffix: "16G-10",
                title: "16G, диаметр 10 мм",
                materialFinish: "yellow_gold",
                gauge: "16g",
                diameterMm: "10.0",
                priceRub: 1650000,
                inventoryQuantity: 3,
            },
        ],
    },
    {
        handle: "titanium-labret-opal",
        title: "Лабрет титановый с опалом",
        description:
            "Имплантационный титан с синтетическим белым опалом 3 мм. Плоский диск надёжно держит украшение в зоне губы.",
        categoryHandle: "lip",
        material: "titanium",
        jewelryType: "labret",
        threading: "internal",
        status: "published",
        isFeatured: false,
        has3dModel: false,
        thumbnailUrl: null,
        areas: ["lip_labret", "lip_medusa", "lip_monroe"],
        variants: [
            {
                skuSuffix: "16G-8",
                title: "16G, длина 8 мм",
                materialFinish: "polished_titanium",
                gauge: "16g",
                lengthMm: "8.0",
                priceRub: 240000,
                inventoryQuantity: 6,
                gemType: "opal",
                gemColor: "white",
            },
            {
                skuSuffix: "14G-10",
                title: "14G, длина 10 мм",
                materialFinish: "polished_titanium",
                gauge: "14g",
                lengthMm: "10.0",
                priceRub: 260000,
                inventoryQuantity: 5,
                gemType: "opal",
                gemColor: "white",
            },
        ],
    },
    {
        handle: "septum-clicker-titanium",
        title: "Кликер для септума, титан",
        description:
            "Удобный кликерный механизм, без видимых стыков. Доступен в нескольких диаметрах.",
        categoryHandle: "nose",
        material: "titanium",
        jewelryType: "ring",
        threading: null,
        status: "published",
        isFeatured: false,
        has3dModel: false,
        thumbnailUrl: null,
        areas: ["nose_septum"],
        variants: [
            {
                skuSuffix: "16G-8",
                title: "16G, диаметр 8 мм",
                materialFinish: "polished_titanium",
                gauge: "16g",
                diameterMm: "8.0",
                priceRub: 180000,
                inventoryQuantity: 7,
            },
            {
                skuSuffix: "14G-10",
                title: "14G, диаметр 10 мм",
                materialFinish: "polished_titanium",
                gauge: "14g",
                diameterMm: "10.0",
                priceRub: 200000,
                inventoryQuantity: 5,
            },
        ],
    },
    {
        handle: "eyebrow-barbell-curved",
        title: "Изогнутая штанга для брови",
        description: "Биосовместимый титан, изогнутая форма повторяет анатомию надбровной дуги.",
        categoryHandle: "eyebrow",
        material: "titanium",
        jewelryType: "barbell",
        threading: "external",
        status: "published",
        isFeatured: false,
        has3dModel: false,
        thumbnailUrl: null,
        areas: ["eyebrow"],
        variants: [
            {
                skuSuffix: "16G-8",
                title: "16G, длина 8 мм",
                materialFinish: "polished_titanium",
                gauge: "16g",
                lengthMm: "8.0",
                priceRub: 150000,
                inventoryQuantity: 10,
            },
        ],
    },
    {
        handle: "navel-banana-cz",
        title: "Банан для пупка с цирконом",
        description:
            "Изогнутая штанга 14G со съёмными декоративными шариками, верхний с цирконом 5 мм.",
        categoryHandle: "navel",
        material: "titanium",
        jewelryType: "barbell",
        threading: "external",
        status: "published",
        isFeatured: true,
        has3dModel: false,
        thumbnailUrl: null,
        areas: ["navel"],
        variants: [
            {
                skuSuffix: "14G-10",
                title: "14G, длина 10 мм",
                materialFinish: "polished_titanium",
                gauge: "14g",
                lengthMm: "10.0",
                priceRub: 280000,
                inventoryQuantity: 8,
                gemType: "cz",
                gemColor: "clear",
            },
            {
                skuSuffix: "14G-12",
                title: "14G, длина 12 мм",
                materialFinish: "polished_titanium",
                gauge: "14g",
                lengthMm: "12.0",
                priceRub: 290000,
                inventoryQuantity: 6,
                gemType: "cz",
                gemColor: "clear",
            },
        ],
    },
    {
        handle: "dermal-anchor-titanium",
        title: "Накожный микродермал",
        description: "Имплантат с плоским якорем 2 мм и сменной накруткой. Внутренняя резьба.",
        categoryHandle: "dermal",
        material: "titanium",
        jewelryType: "dermal",
        threading: "internal",
        status: "published",
        isFeatured: false,
        has3dModel: false,
        thumbnailUrl: null,
        areas: ["dermal_chest", "dermal_face", "dermal_back"],
        variants: [
            {
                skuSuffix: "ANCH-2MM",
                title: "Якорь 2 мм",
                materialFinish: "polished_titanium",
                gauge: "14g",
                lengthMm: "2.0",
                priceRub: 320000,
                inventoryQuantity: 5,
            },
            {
                skuSuffix: "TOP-CZ-3",
                title: "Накрутка циркон 3 мм",
                materialFinish: "polished_titanium",
                gauge: "14g",
                lengthMm: "3.0",
                priceRub: 90000,
                inventoryQuantity: 15,
                gemType: "cz",
                gemColor: "clear",
            },
        ],
    },
    {
        handle: "rose-gold-stud-pearl",
        title: "Розовое золото с жемчугом",
        description:
            "Золото 14K розового оттенка с натуральным пресноводным жемчугом 4 мм. Внутренняя резьба.",
        categoryHandle: "ear",
        material: "gold_14k",
        jewelryType: "stud",
        threading: "internal",
        status: "published",
        isFeatured: true,
        has3dModel: false,
        thumbnailUrl: null,
        areas: ["ear_lobe", "ear_helix"],
        variants: [
            {
                skuSuffix: "18G-6",
                title: "18G, длина 6 мм",
                materialFinish: "rose_gold",
                gauge: "18g",
                lengthMm: "6.0",
                priceRub: 1820000,
                inventoryQuantity: 3,
                gemType: "pearl",
                gemColor: "white",
            },
        ],
    },
];

async function seedProducts(
    categoryIds: Record<string, string>
): Promise<{ productIds: Record<string, string>; variantIds: Record<string, string> }> {
    const productIds: Record<string, string> = {};
    const variantIds: Record<string, string> = {};
    const now = new Date();

    for (const seed of productSeeds) {
        const productId = await ensureByHandle(products, {
            handle: seed.handle,
            title: seed.title,
            description: seed.description,
            categoryId: categoryIds[seed.categoryHandle],
            material: seed.material,
            jewelryType: seed.jewelryType,
            threading: seed.threading,
            status: seed.status,
            publishedAt: seed.status === "published" ? now : null,
            isFeatured: seed.isFeatured,
            has3dModel: seed.has3dModel,
            thumbnailUrl: seed.thumbnailUrl,
        });
        productIds[seed.handle] = productId;

        // Variants
        for (const v of seed.variants) {
            const sku = `${seed.handle}::${v.skuSuffix}`;
            const id = await ensureBySku({
                productId,
                title: v.title,
                sku,
                materialFinish: v.materialFinish,
                gauge: v.gauge,
                lengthMm: v.lengthMm,
                diameterMm: v.diameterMm,
                gemType: v.gemType,
                gemColor: v.gemColor,
                priceRub: v.priceRub,
                manageInventory: true,
                inventoryQuantity: v.inventoryQuantity,
            });
            variantIds[sku] = id;
        }

        // Piercing-area links (composite PK enables conflict-do-nothing on the pair)
        for (const area of seed.areas) {
            await db
                .insert(productPiercingAreas)
                .values({ productId, piercingArea: area })
                .onConflictDoNothing({
                    target: [productPiercingAreas.productId, productPiercingAreas.piercingArea],
                });
        }
    }

    const variantCount = Object.keys(variantIds).length;
    console.log(`  ✓ Products (${productSeeds.length}) + variants (${variantCount}) + areas`);
    return { productIds, variantIds };
}

// ---------------------------------------------------------------------------
// 5b. Product media (one primary placeholder image per product)
// ---------------------------------------------------------------------------
async function seedProductMedia(productIds: Record<string, string>): Promise<void> {
    let created = 0;
    for (const [handle, productId] of Object.entries(productIds)) {
        const existing = await db
            .select({ id: productMedia.id })
            .from(productMedia)
            .where(and(eq(productMedia.productId, productId), eq(productMedia.isPrimary, true)))
            .limit(1);
        if (existing[0]?.id) continue;
        await db.insert(productMedia).values({
            productId,
            url: `/placeholder/products/${handle}.webp`,
            alt: handle,
            kind: "image",
            isPrimary: true,
            sortOrder: 0,
        });
        created++;
    }
    console.log(
        `  ✓ Product media (${created} new primary rows, ${
            Object.keys(productIds).length - created
        } already present)`
    );
}

// ---------------------------------------------------------------------------
// 6. Booking services
// ---------------------------------------------------------------------------
async function seedServices(): Promise<Record<string, string>> {
    const rows = [
        {
            handle: "consultation",
            name: "Бесплатная консультация",
            category: "consultation",
            subcategory: null,
            description: "20-минутная встреча: подбор зоны, материала и украшения.",
            durationMinutes: 20,
            priceFrom: 0,
            priceTo: 0,
            requiresConsultation: false,
            jewelryIncluded: false,
            sortOrder: 1,
        },
        {
            handle: "piercing-lobe",
            name: "Прокол мочки уха",
            category: "new_piercing",
            subcategory: "ear",
            description: "Стерильная игла, имплантационный титан в стоимости.",
            durationMinutes: 30,
            priceFrom: 250000,
            priceTo: 350000,
            jewelryIncluded: true,
            healingTimeMinWeeks: 6,
            healingTimeMaxWeeks: 12,
            sortOrder: 10,
        },
        {
            handle: "piercing-helix",
            name: "Прокол хеликса",
            category: "new_piercing",
            subcategory: "ear",
            description: "Прокол верхней части ушной раковины. Заживление 6–12 мес.",
            durationMinutes: 40,
            priceFrom: 350000,
            priceTo: 500000,
            jewelryIncluded: true,
            healingTimeMinWeeks: 24,
            healingTimeMaxWeeks: 48,
            sortOrder: 11,
        },
        {
            handle: "piercing-septum",
            name: "Прокол септума",
            category: "new_piercing",
            subcategory: "nose",
            description: "Прокол хрящевой перегородки носа.",
            durationMinutes: 30,
            priceFrom: 400000,
            priceTo: 550000,
            jewelryIncluded: true,
            healingTimeMinWeeks: 8,
            healingTimeMaxWeeks: 16,
            sortOrder: 20,
        },
        {
            handle: "piercing-nostril",
            name: "Прокол ноздри",
            category: "new_piercing",
            subcategory: "nose",
            description: "Классический прокол крыла носа.",
            durationMinutes: 30,
            priceFrom: 300000,
            priceTo: 450000,
            jewelryIncluded: true,
            healingTimeMinWeeks: 12,
            healingTimeMaxWeeks: 24,
            sortOrder: 21,
        },
        {
            handle: "piercing-navel",
            name: "Прокол пупка",
            category: "new_piercing",
            subcategory: "navel",
            description: "Прокол верхнего или нижнего края пупка.",
            durationMinutes: 40,
            priceFrom: 400000,
            priceTo: 550000,
            jewelryIncluded: true,
            healingTimeMinWeeks: 24,
            healingTimeMaxWeeks: 52,
            sortOrder: 30,
        },
        {
            handle: "jewelry-change",
            name: "Смена украшения",
            category: "jewelry_change",
            subcategory: null,
            description: "Снятие старого и установка нового украшения.",
            durationMinutes: 15,
            priceFrom: 100000,
            priceTo: 200000,
            jewelryIncluded: false,
            sortOrder: 40,
        },
    ] as const;
    const map: Record<string, string> = {};
    for (const row of rows) {
        map[row.handle] = await ensureByHandle(services, row);
    }
    console.log(`  ✓ Services (${rows.length})`);
    return map;
}

// ---------------------------------------------------------------------------
// 7. Body model + piercing points (subset of public/piercing_points_v6.json)
// ---------------------------------------------------------------------------
async function seedBodyModel(
    serviceIds: Record<string, string>
): Promise<{ bodyModelId: string; pointIds: Record<string, string> }> {
    await db
        .insert(bodyModels)
        .values({
            id: BODY_MODEL_HEAD_ID,
            name: "Head & ears (default)",
            area: "face",
            side: null,
            modelUrl: "/model_v6.glb",
            thumbnailUrl: null,
            polygonCount: 50000,
            cameraDefaults: {
                position: [0, 1.65, 0.6],
                target: [0, 1.65, 0],
                fov: 35,
                minDistance: 0.3,
                maxDistance: 1.8,
            },
            skinTextures: [],
            version: 6,
            isActive: true,
        })
        .onConflictDoNothing({ target: bodyModels.id });

    const anchors: Array<{
        name: string;
        displayName: string;
        positionX: string;
        positionY: string;
        positionZ: string;
        normalX: string;
        normalY: string;
        normalZ: string;
        compatibleJewelryTypes: string[];
        compatibleGauges: string[];
        serviceHandle: string | null;
        sortOrder: number;
    }> = [
        {
            name: "left_earlobe",
            displayName: "Левая мочка уха",
            positionX: "0.0722",
            positionY: "1.6340",
            positionZ: "-0.0149",
            normalX: "0.6331",
            normalY: "-0.5828",
            normalZ: "0.5094",
            compatibleJewelryTypes: ["stud", "hoop", "ring"],
            compatibleGauges: ["20g", "18g", "16g"],
            serviceHandle: "piercing-lobe",
            sortOrder: 1,
        },
        {
            name: "left_nostril",
            displayName: "Левая ноздря",
            positionX: "0.0040",
            positionY: "1.6532",
            positionZ: "0.0961",
            normalX: "0.6595",
            normalY: "0.4578",
            normalZ: "0.5962",
            compatibleJewelryTypes: ["stud", "ring"],
            compatibleGauges: ["20g", "18g"],
            serviceHandle: "piercing-nostril",
            sortOrder: 2,
        },
        {
            name: "labret",
            displayName: "Лабрет",
            positionX: "0.0000",
            positionY: "1.6059",
            positionZ: "0.0822",
            normalX: "-0.1319",
            normalY: "-0.5406",
            normalZ: "0.8309",
            compatibleJewelryTypes: ["stud", "ring"],
            compatibleGauges: ["16g", "14g"],
            serviceHandle: null,
            sortOrder: 3,
        },
        {
            name: "left_eyebrow",
            displayName: "Левая бровь",
            positionX: "0.0350",
            positionY: "1.7174",
            positionZ: "0.0764",
            normalX: "0.4630",
            normalY: "0.2134",
            normalZ: "0.8603",
            compatibleJewelryTypes: ["barbell", "ring"],
            compatibleGauges: ["16g", "14g"],
            serviceHandle: null,
            sortOrder: 4,
        },
    ];

    const pointIds: Record<string, string> = {};
    for (const a of anchors) {
        const existing = await db
            .select({ id: piercingPoints.id })
            .from(piercingPoints)
            .where(
                and(
                    eq(piercingPoints.bodyModelId, BODY_MODEL_HEAD_ID),
                    eq(piercingPoints.name, a.name)
                )
            )
            .limit(1);
        if (existing[0]?.id) {
            pointIds[a.name] = existing[0].id;
            continue;
        }
        const [created] = await db
            .insert(piercingPoints)
            .values({
                bodyModelId: BODY_MODEL_HEAD_ID,
                name: a.name,
                displayName: a.displayName,
                positionX: a.positionX,
                positionY: a.positionY,
                positionZ: a.positionZ,
                normalX: a.normalX,
                normalY: a.normalY,
                normalZ: a.normalZ,
                compatibleJewelryTypes: a.compatibleJewelryTypes,
                compatibleGauges: a.compatibleGauges,
                serviceId: a.serviceHandle ? serviceIds[a.serviceHandle] : null,
                sortOrder: a.sortOrder,
                isActive: true,
            })
            .returning({ id: piercingPoints.id });
        pointIds[a.name] = created.id;
    }

    console.log(`  ✓ Body model + ${anchors.length} piercing points`);
    return { bodyModelId: BODY_MODEL_HEAD_ID, pointIds };
}

// ---------------------------------------------------------------------------
// 8. Jewelry 3D models (one per product flagged has_3d_model)
// ---------------------------------------------------------------------------
async function seedJewelry3d(productIds: Record<string, string>): Promise<void> {
    const seeds = [
        {
            productHandle: "titanium-stud-cz-3mm",
            modelUrl: "/jewelry/titanium-stud-cz-3mm.glb",
            jewelryType: "stud",
            defaultAttachment: "left_earlobe",
        },
        {
            productHandle: "gold-14k-hoop-8mm",
            modelUrl: "/jewelry/gold-14k-hoop-8mm.glb",
            jewelryType: "hoop",
            defaultAttachment: "left_earlobe",
        },
    ];

    let created = 0;
    for (const s of seeds) {
        const productId = productIds[s.productHandle];
        if (!productId) continue;
        const existing = await db
            .select({ id: jewelry3dModels.id })
            .from(jewelry3dModels)
            .where(eq(jewelry3dModels.productId, productId))
            .limit(1);
        if (existing[0]?.id) continue;
        await db.insert(jewelry3dModels).values({
            productId,
            modelUrl: s.modelUrl,
            jewelryType: s.jewelryType,
            defaultAttachment: s.defaultAttachment,
            isValidated: true,
            status: "active",
        });
        created++;
    }
    console.log(`  ✓ Jewelry 3D models (${created} new, ${seeds.length - created} existing)`);
}

// ---------------------------------------------------------------------------
// 9. Blog category + posts
// ---------------------------------------------------------------------------
async function seedBlog(): Promise<void> {
    const categoryId = await ensureByHandle(blogCategories, {
        handle: "aftercare",
        name: "Заживление и уход",
        sortOrder: 1,
    });

    const now = new Date();
    const posts = [
        {
            slug: "kak-uhazhivat-za-piercingom",
            title: "Как ухаживать за свежим пирсингом",
            excerpt: "5 базовых правил, которые помогут заживлению пройти без осложнений.",
            content:
                "# Базовый уход\n\n1. Промывайте физраствором 2 раза в день\n2. Не трогайте руками\n3. Спите на чистой подушке\n4. Не прокручивайте украшение\n5. Избегайте бассейнов первые 4 недели",
            categoryId,
            status: "published",
            publishedAt: now,
            readTimeMin: 4,
            tags: ["уход", "заживление"],
        },
        {
            slug: "vybor-materiala-ukrasheniya",
            title: "Как выбрать материал украшения для первого пирсинга",
            excerpt: "Титан, золото, ниобий — что подойдёт именно вам.",
            content:
                "# Материалы\n\n## Имплантационный титан ASTM F-136\nЛучший выбор для свежего прокола.\n\n## Золото 14K и 18K\nПодходит после полного заживления.",
            categoryId,
            status: "published",
            publishedAt: now,
            readTimeMin: 6,
            tags: ["материалы", "выбор"],
        },
    ];
    for (const p of posts) {
        await ensureBySlug(blogPosts, p);
    }
    console.log(`  ✓ Blog (1 category, ${posts.length} posts)`);
}

// ---------------------------------------------------------------------------
// 10. Aftercare guide
// ---------------------------------------------------------------------------
async function seedAftercare(serviceIds: Record<string, string>): Promise<void> {
    await ensureByHandle(aftercareGuides, {
        handle: "helix",
        title: "Уход за пирсингом хеликса",
        piercingType: "ear_helix",
        content: {
            overview: "Хелекс заживает медленно (6–12 мес). Главное — чистота и минимум давления.",
            timeline: [
                { week: 1, note: "Опухоль, чувствительность" },
                { week: 4, note: "Корочки уменьшаются" },
                { week: 12, note: "Можно менять украшение под наблюдением мастера" },
                { week: 48, note: "Полное заживление" },
            ],
            daily_routine: ["Промывание 2 раза в день", "Сухое промакивание"],
            dos: ["Спите на противоположной стороне", "Носите свободную одежду"],
            donts: ["Не используйте перекись и спирт", "Не меняйте украшение без мастера"],
            warning_signs: ["Гной", "Сильное покраснение более 7 дней", "Температура"],
            downsizing: "Замена на короткую штангу через 8–12 недель.",
        },
        healingMinWeeks: 24,
        healingMaxWeeks: 48,
        serviceId: serviceIds["piercing-helix"] ?? null,
        version: 1,
        isPublished: true,
    });
    console.log("  ✓ Aftercare guide (helix)");
}

// ---------------------------------------------------------------------------
// 11. Portfolio image
// ---------------------------------------------------------------------------
async function seedPortfolio(): Promise<void> {
    const existing = await db.select({ id: portfolioImages.id }).from(portfolioImages).limit(1);
    if (existing[0]?.id) {
        console.log("  ✓ Portfolio (already seeded)");
        return;
    }
    await db.insert(portfolioImages).values({
        imageUrl: "/portfolio/sample-helix.jpg",
        piercingType: "ear_helix",
        description: "Двойной хеликс с титановыми гвоздиками",
        clientConsent: true,
        sortOrder: 1,
    });
    console.log("  ✓ Portfolio (1 image)");
}

// ---------------------------------------------------------------------------
// 12. Curated look
// ---------------------------------------------------------------------------
async function seedCuratedLook(
    bodyModelId: string,
    pointIds: Record<string, string>,
    variantIds: Record<string, string>
): Promise<void> {
    const lobeVariant = variantIds["titanium-stud-cz-3mm::18G-6"];
    const nostrilVariant = variantIds["septum-clicker-titanium::16G-8"];
    if (!lobeVariant || !nostrilVariant) {
        console.log("  ⚠ Curated look skipped (variants missing)");
        return;
    }

    const totalIndividual = 130000 + 180000;
    const bundle = 280000;

    const lookId = await ensureByHandle(curatedLooks, {
        handle: "minimal-titanium",
        title: "Минимализм в титане",
        description: "Лёгкий повседневный сет: гвоздик в мочку и кликер в септум.",
        bodyModelId,
        bodyArea: "face",
        totalIndividualPrice: totalIndividual,
        bundlePrice: bundle,
        discountPercent: "9.7",
        cameraState: { position: [0, 1.65, 0.55], target: [0, 1.65, 0] },
        isPublished: true,
        sortOrder: 1,
    });

    const pieces = [
        { piercingPoint: "left_earlobe", variantId: lobeVariant, sortOrder: 1 },
        { piercingPoint: "labret", variantId: nostrilVariant, sortOrder: 2 },
    ];
    for (const p of pieces) {
        const pointId = pointIds[p.piercingPoint];
        if (!pointId) continue;
        const existing = await db
            .select({ id: lookPieces.id })
            .from(lookPieces)
            .where(
                and(
                    eq(lookPieces.lookId, lookId),
                    eq(lookPieces.piercingPointId, pointId),
                    eq(lookPieces.variantId, p.variantId)
                )
            )
            .limit(1);
        if (existing[0]?.id) continue;
        await db.insert(lookPieces).values({
            lookId,
            piercingPointId: pointId,
            variantId: p.variantId,
            sortOrder: p.sortOrder,
        });
    }
    console.log("  ✓ Curated look (1, with 2 pieces)");
}

// ---------------------------------------------------------------------------
// 13. Waiver template
// ---------------------------------------------------------------------------
async function seedWaiverTemplate(): Promise<void> {
    await db
        .insert(waiverTemplates)
        .values({
            version: 1,
            content:
                "# Согласие на проведение пирсинга\n\nЯ подтверждаю, что мне исполнилось 18 лет, " +
                "ознакомлен(а) с противопоказаниями, рисками и правилами ухода.",
            isActive: true,
        })
        .onConflictDoNothing({ target: waiverTemplates.version });
    console.log("  ✓ Waiver template v1");
}

// ---------------------------------------------------------------------------
// Orchestrator
// ---------------------------------------------------------------------------
async function seed(): Promise<void> {
    console.log("🌱 Seeding database…");

    await seedPiercerProfile();
    await seedSchedule();
    await seedSettings();
    const categoryIds = await seedCategories();
    const { productIds, variantIds } = await seedProducts(categoryIds);
    await seedProductMedia(productIds);
    const serviceIds = await seedServices();
    const { bodyModelId, pointIds } = await seedBodyModel(serviceIds);
    await seedJewelry3d(productIds);
    await seedBlog();
    await seedAftercare(serviceIds);
    await seedPortfolio();
    await seedCuratedLook(bodyModelId, pointIds, variantIds);
    await seedWaiverTemplate();

    console.log("\n✅ Seed complete.");
    process.exit(0);
}

seed().catch((err) => {
    console.error("\n❌ Seed failed:", err);
    process.exit(1);
});
