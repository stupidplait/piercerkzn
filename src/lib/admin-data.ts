// ── Types ─────────────────────────────────────────────────────────────────────

export type ProductStatus = "published" | "draft" | "archived";
export type MaterialType = "titanium" | "gold_14k" | "gold_18k" | "implant_steel" | "niobium";
export type JewelryType =
    | "stud"
    | "hoop"
    | "barbell"
    | "labret"
    | "segment_ring"
    | "captive_ring"
    | "threadless";
export type AppointmentStatus = "pending" | "confirmed" | "completed" | "cancelled" | "no_show";
export type ReservationStatus = "pending" | "confirmed" | "picked_up" | "expired" | "cancelled";
export type BlogStatus = "published" | "draft";

export interface Product {
    id: string;
    handle: string;
    title: string;
    category: string;
    material: MaterialType;
    type: JewelryType;
    status: ProductStatus;
    price: number;
    stock: number;
    tags: string[];
    createdAt: string;
}

export interface Appointment {
    id: string;
    referenceNumber: string;
    clientName: string;
    clientPhone: string;
    clientEmail: string;
    service: string;
    date: string;
    timeStart: string;
    timeEnd: string;
    durationMin: number;
    status: AppointmentStatus;
    notes: string;
    totalPrice: number;
    waiverSigned: boolean;
}

export interface ReservationItem {
    id: string;
    productTitle: string;
    variantTitle: string;
    sku: string;
    quantity: number;
    unitPrice: number;
}

export interface Reservation {
    id: string;
    referenceNumber: string;
    customerName: string;
    customerPhone: string;
    customerEmail: string;
    items: ReservationItem[];
    total: number;
    status: ReservationStatus;
    expiresAt: string;
    createdAt: string;
    notes: string;
}

export interface Client {
    id: string;
    firstName: string;
    lastName: string;
    phone: string;
    email: string;
    dateOfBirth: string;
    totalAppointments: number;
    totalReservations: number;
    lastVisit: string;
    createdAt: string;
    notes: string;
    allergies: string;
}

export interface BlogPost {
    id: string;
    title: string;
    slug: string;
    status: BlogStatus;
    views: number;
    createdAt: string;
    publishedAt: string;
    excerpt: string;
}

export interface ActivityItem {
    id: string;
    type:
        | "reservation_created"
        | "appointment_booked"
        | "product_updated"
        | "reservation_confirmed"
        | "appointment_completed"
        | "client_registered";
    text: string;
    time: string;
    dotColor: "green" | "amber" | "magenta" | "gray";
}

export interface DashStats {
    appointmentsToday: number;
    appointmentsDelta: string;
    activeReservations: number;
    reservationsDelta: string;
    catalogItems: number;
    catalogDelta: string;
    totalClients: number;
    clientsDelta: string;
}

// ── Products ──────────────────────────────────────────────────────────────────

export const mockProducts: Product[] = [
    {
        id: "p1",
        handle: "kolco-segmentnoe-8mm",
        title: "Кольцо сегментное 8мм",
        category: "Кольца",
        material: "titanium",
        type: "segment_ring",
        status: "published",
        price: 2200,
        stock: 12,
        tags: ["хрящ", "сегментное", "титан"],
        createdAt: "2025-03-10",
    },
    {
        id: "p2",
        handle: "labret-s-raduzhnvm-opalom",
        title: "Лабрет с радужным опалом",
        category: "Лабреты",
        material: "gold_14k",
        type: "labret",
        status: "published",
        price: 5800,
        stock: 3,
        tags: ["опал", "золото", "14к", "лабрет"],
        createdAt: "2025-04-02",
    },
    {
        id: "p3",
        handle: "shtanga-dlya-khryashcha-16g",
        title: "Штанга для хряща 16G",
        category: "Штанги",
        material: "titanium",
        type: "barbell",
        status: "published",
        price: 1800,
        stock: 8,
        tags: ["хрящ", "штанга", "титан", "16G"],
        createdAt: "2025-02-18",
    },
    {
        id: "p4",
        handle: "kolco-xinzh-10mm",
        title: "Кольцо хинж 10мм",
        category: "Кольца",
        material: "implant_steel",
        type: "hoop",
        status: "published",
        price: 3200,
        stock: 5,
        tags: ["хинж", "сталь", "имплантат"],
        createdAt: "2025-04-15",
    },
    {
        id: "p5",
        handle: "stad-s-belym-cz",
        title: "Стад с белым CZ",
        category: "Стады",
        material: "gold_18k",
        type: "stud",
        status: "published",
        price: 4500,
        stock: 6,
        tags: ["CZ", "золото", "18к", "стад"],
        createdAt: "2025-05-01",
    },
    {
        id: "p6",
        handle: "nostril-l-obraznyy",
        title: "Нострил L-образный",
        category: "Ностри",
        material: "titanium",
        type: "stud",
        status: "published",
        price: 1600,
        stock: 15,
        tags: ["нос", "ноздря", "титан", "L-образный"],
        createdAt: "2025-03-22",
    },
    {
        id: "p7",
        handle: "kolco-kliker-10mm",
        title: "Кольцо-кликер 10мм",
        category: "Кольца",
        material: "niobium",
        type: "captive_ring",
        status: "draft",
        price: 2800,
        stock: 4,
        tags: ["кликер", "ниобий", "кольцо"],
        createdAt: "2025-05-20",
    },
    {
        id: "p8",
        handle: "labret-ploskiy-8mm",
        title: "Лабрет плоский 8мм",
        category: "Лабреты",
        material: "titanium",
        type: "labret",
        status: "published",
        price: 2100,
        stock: 9,
        tags: ["лабрет", "плоский", "титан"],
        createdAt: "2025-01-30",
    },
    {
        id: "p9",
        handle: "shtanga-izognutaya-pvd",
        title: "Штанга изогнутая PVD",
        category: "Штанги",
        material: "implant_steel",
        type: "barbell",
        status: "published",
        price: 2600,
        stock: 2,
        tags: ["PVD", "штанга", "изогнутая", "сталь"],
        createdAt: "2025-06-01",
    },
    {
        id: "p10",
        handle: "kolco-zolotoe-8mm",
        title: "Кольцо золотое 8мм",
        category: "Кольца",
        material: "gold_14k",
        type: "segment_ring",
        status: "draft",
        price: 6900,
        stock: 7,
        tags: ["золото", "14к", "кольцо"],
        createdAt: "2025-06-10",
    },
];

// ── Appointments ──────────────────────────────────────────────────────────────

export const mockAppointments: Appointment[] = [
    {
        id: "a1",
        referenceNumber: "PK-APT-2025-0041",
        clientName: "Анастасия Волкова",
        clientPhone: "+7 916 245-38-71",
        clientEmail: "anastasia.volkova@gmail.com",
        service: "Пирсинг мочки уха",
        date: "2025-07-14",
        timeStart: "11:00",
        timeEnd: "12:00",
        durationMin: 60,
        status: "confirmed",
        notes: "Первый пирсинг, беспокоится о болезненности",
        totalPrice: 1500,
        waiverSigned: true,
    },
    {
        id: "a2",
        referenceNumber: "PK-APT-2025-0042",
        clientName: "Кирилл Захаров",
        clientPhone: "+7 903 187-54-20",
        clientEmail: "kirill.zaharov@mail.ru",
        service: "Пирсинг хряща",
        date: "2025-07-14",
        timeStart: "13:30",
        timeEnd: "14:15",
        durationMin: 45,
        status: "confirmed",
        notes: "",
        totalPrice: 2000,
        waiverSigned: true,
    },
    {
        id: "a3",
        referenceNumber: "PK-APT-2025-0043",
        clientName: "Мария Соколова",
        clientPhone: "+7 925 312-90-44",
        clientEmail: "maria.sokolova@yandex.ru",
        service: "Пирсинг ноздри",
        date: "2025-07-14",
        timeStart: "15:00",
        timeEnd: "15:30",
        durationMin: 30,
        status: "completed",
        notes: "Клиент остался доволен",
        totalPrice: 1800,
        waiverSigned: true,
    },
    {
        id: "a4",
        referenceNumber: "PK-APT-2025-0044",
        clientName: "Дмитрий Орлов",
        clientPhone: "+7 912 678-22-15",
        clientEmail: "dmitry.orlov@gmail.com",
        service: "Пирсинг перегородки",
        date: "2025-07-15",
        timeStart: "10:30",
        timeEnd: "11:15",
        durationMin: 45,
        status: "confirmed",
        notes: "Повторный клиент",
        totalPrice: 2500,
        waiverSigned: true,
    },
    {
        id: "a5",
        referenceNumber: "PK-APT-2025-0045",
        clientName: "Арина Новикова",
        clientPhone: "+7 988 541-67-33",
        clientEmail: "arina.novikova@gmail.com",
        service: "Пирсинг губы",
        date: "2025-07-15",
        timeStart: "14:00",
        timeEnd: "14:30",
        durationMin: 30,
        status: "pending",
        notes: "",
        totalPrice: 1800,
        waiverSigned: false,
    },
    {
        id: "a6",
        referenceNumber: "PK-APT-2025-0046",
        clientName: "Сергей Петров",
        clientPhone: "+7 917 892-11-48",
        clientEmail: "sergei.petrov@mail.ru",
        service: "Замена украшения",
        date: "2025-07-16",
        timeStart: "12:00",
        timeEnd: "12:20",
        durationMin: 20,
        status: "confirmed",
        notes: "Замена лабрета на кольцо",
        totalPrice: 800,
        waiverSigned: true,
    },
    {
        id: "a7",
        referenceNumber: "PK-APT-2025-0047",
        clientName: "Валерия Морозова",
        clientPhone: "+7 906 234-85-62",
        clientEmail: "valeria.morozova@yandex.ru",
        service: "Пирсинг мочки уха",
        date: "2025-07-17",
        timeStart: "11:30",
        timeEnd: "12:30",
        durationMin: 60,
        status: "confirmed",
        notes: "Парный пирсинг",
        totalPrice: 2800,
        waiverSigned: false,
    },
    {
        id: "a8",
        referenceNumber: "PK-APT-2025-0048",
        clientName: "Иван Смирнов",
        clientPhone: "+7 967 445-29-87",
        clientEmail: "ivan.smirnov@gmail.com",
        service: "Пирсинг хряща",
        date: "2025-07-18",
        timeStart: "16:00",
        timeEnd: "16:45",
        durationMin: 45,
        status: "pending",
        notes: "",
        totalPrice: 2000,
        waiverSigned: false,
    },
    {
        id: "a9",
        referenceNumber: "PK-APT-2025-0049",
        clientName: "Екатерина Лебедева",
        clientPhone: "+7 919 672-38-14",
        clientEmail: "ekaterina.lebedeva@mail.ru",
        service: "Пирсинг ноздри",
        date: "2025-07-19",
        timeStart: "13:00",
        timeEnd: "13:30",
        durationMin: 30,
        status: "completed",
        notes: "Всё прошло хорошо",
        totalPrice: 1800,
        waiverSigned: true,
    },
    {
        id: "a10",
        referenceNumber: "PK-APT-2025-0050",
        clientName: "Алексей Попов",
        clientPhone: "+7 931 117-60-25",
        clientEmail: "aleksei.popov@yandex.ru",
        service: "Пирсинг перегородки",
        date: "2025-07-21",
        timeStart: "15:30",
        timeEnd: "16:15",
        durationMin: 45,
        status: "confirmed",
        notes: "",
        totalPrice: 2500,
        waiverSigned: true,
    },
    {
        id: "a11",
        referenceNumber: "PK-APT-2025-0051",
        clientName: "Ольга Фёдорова",
        clientPhone: "+7 952 384-71-09",
        clientEmail: "olga.fedorova@gmail.com",
        service: "Пирсинг губы",
        date: "2025-07-22",
        timeStart: "11:00",
        timeEnd: "11:30",
        durationMin: 30,
        status: "pending",
        notes: "Уточнить тип украшения",
        totalPrice: 1800,
        waiverSigned: false,
    },
    {
        id: "a12",
        referenceNumber: "PK-APT-2025-0052",
        clientName: "Павел Соловьёв",
        clientPhone: "+7 945 228-93-56",
        clientEmail: "pavel.solovev@mail.ru",
        service: "Замена украшения",
        date: "2025-07-25",
        timeStart: "14:00",
        timeEnd: "14:20",
        durationMin: 20,
        status: "confirmed",
        notes: "",
        totalPrice: 800,
        waiverSigned: true,
    },
];

// ── Reservations ──────────────────────────────────────────────────────────────

export const mockReservations: Reservation[] = [
    {
        id: "r1",
        referenceNumber: "PK-RES-2025-0042",
        customerName: "Анастасия Волкова",
        customerPhone: "+7 916 245-38-71",
        customerEmail: "anastasia.volkova@gmail.com",
        items: [
            {
                id: "ri1",
                productTitle: "Лабрет с радужным опалом",
                variantTitle: "8мм · Золото 14к",
                sku: "LBR-OPL-14K-8",
                quantity: 1,
                unitPrice: 5800,
            },
            {
                id: "ri2",
                productTitle: "Кольцо сегментное 8мм",
                variantTitle: "8мм · Титан",
                sku: "RNG-SEG-TI-8",
                quantity: 1,
                unitPrice: 2200,
            },
        ],
        total: 8000,
        status: "pending",
        expiresAt: "2025-07-16T14:23:00Z",
        createdAt: "2025-07-13T14:23:00Z",
        notes: "",
    },
    {
        id: "r2",
        referenceNumber: "PK-RES-2025-0041",
        customerName: "Кирилл Захаров",
        customerPhone: "+7 903 187-54-20",
        customerEmail: "kirill.zaharov@mail.ru",
        items: [
            {
                id: "ri3",
                productTitle: "Штанга для хряща 16G",
                variantTitle: "8мм · Титан",
                sku: "SHT-HRY-TI-16G",
                quantity: 2,
                unitPrice: 1800,
            },
        ],
        total: 3600,
        status: "confirmed",
        expiresAt: "2025-07-15T09:10:00Z",
        createdAt: "2025-07-12T09:10:00Z",
        notes: "Клиент будет в субботу",
    },
    {
        id: "r3",
        referenceNumber: "PK-RES-2025-0040",
        customerName: "Мария Соколова",
        customerPhone: "+7 925 312-90-44",
        customerEmail: "maria.sokolova@yandex.ru",
        items: [
            {
                id: "ri4",
                productTitle: "Стад с белым CZ",
                variantTitle: "6мм · Золото 18к",
                sku: "STD-CZ-18K-6",
                quantity: 1,
                unitPrice: 4500,
            },
        ],
        total: 4500,
        status: "picked_up",
        expiresAt: "2025-07-12T11:00:00Z",
        createdAt: "2025-07-09T11:00:00Z",
        notes: "",
    },
    {
        id: "r4",
        referenceNumber: "PK-RES-2025-0039",
        customerName: "Дмитрий Орлов",
        customerPhone: "+7 912 678-22-15",
        customerEmail: "dmitry.orlov@gmail.com",
        items: [
            {
                id: "ri5",
                productTitle: "Кольцо хинж 10мм",
                variantTitle: "10мм · Имплантат сталь",
                sku: "RNG-HNG-IS-10",
                quantity: 1,
                unitPrice: 3200,
            },
        ],
        total: 3200,
        status: "pending",
        expiresAt: "2025-07-17T16:45:00Z",
        createdAt: "2025-07-14T16:45:00Z",
        notes: "Бронь со страницы визуализатора",
    },
    {
        id: "r5",
        referenceNumber: "PK-RES-2025-0038",
        customerName: "Арина Новикова",
        customerPhone: "+7 988 541-67-33",
        customerEmail: "arina.novikova@gmail.com",
        items: [
            {
                id: "ri6",
                productTitle: "Нострил L-образный",
                variantTitle: "1мм · Титан",
                sku: "NST-L-TI-1",
                quantity: 2,
                unitPrice: 1600,
            },
        ],
        total: 3200,
        status: "confirmed",
        expiresAt: "2025-07-16T10:20:00Z",
        createdAt: "2025-07-13T10:20:00Z",
        notes: "",
    },
    {
        id: "r6",
        referenceNumber: "PK-RES-2025-0037",
        customerName: "Сергей Петров",
        customerPhone: "+7 917 892-11-48",
        customerEmail: "sergei.petrov@mail.ru",
        items: [
            {
                id: "ri7",
                productTitle: "Лабрет плоский 8мм",
                variantTitle: "8мм · Титан",
                sku: "LBR-PLO-TI-8",
                quantity: 1,
                unitPrice: 2100,
            },
        ],
        total: 2100,
        status: "expired",
        expiresAt: "2025-07-10T08:00:00Z",
        createdAt: "2025-07-07T08:00:00Z",
        notes: "",
    },
    {
        id: "r7",
        referenceNumber: "PK-RES-2025-0036",
        customerName: "Валерия Морозова",
        customerPhone: "+7 906 234-85-62",
        customerEmail: "valeria.morozova@yandex.ru",
        items: [
            {
                id: "ri8",
                productTitle: "Кольцо золотое 8мм",
                variantTitle: "8мм · Золото 14к",
                sku: "RNG-ZOL-14K-8",
                quantity: 1,
                unitPrice: 6900,
            },
            {
                id: "ri9",
                productTitle: "Лабрет с радужным опалом",
                variantTitle: "6мм · Золото 14к",
                sku: "LBR-OPL-14K-6",
                quantity: 1,
                unitPrice: 5800,
            },
        ],
        total: 12700,
        status: "pending",
        expiresAt: "2025-07-17T20:15:00Z",
        createdAt: "2025-07-14T20:15:00Z",
        notes: "VIP-клиент, постоянная",
    },
    {
        id: "r8",
        referenceNumber: "PK-RES-2025-0035",
        customerName: "Иван Смирнов",
        customerPhone: "+7 967 445-29-87",
        customerEmail: "ivan.smirnov@gmail.com",
        items: [
            {
                id: "ri10",
                productTitle: "Штанга изогнутая PVD",
                variantTitle: "10мм · Сталь PVD",
                sku: "SHT-PVD-IS-10",
                quantity: 1,
                unitPrice: 2600,
            },
        ],
        total: 2600,
        status: "cancelled",
        expiresAt: "2025-07-08T13:30:00Z",
        createdAt: "2025-07-05T13:30:00Z",
        notes: "Клиент отменил сам",
    },
];

// ── Clients ───────────────────────────────────────────────────────────────────

export const mockClients: Client[] = [
    {
        id: "c1",
        firstName: "Анастасия",
        lastName: "Волкова",
        phone: "+7 916 245-38-71",
        email: "anastasia.volkova@gmail.com",
        dateOfBirth: "2001-05-12",
        totalAppointments: 3,
        totalReservations: 2,
        lastVisit: "2025-07-14",
        createdAt: "2024-11-20",
        notes: "Постоянный клиент, предпочитает титан",
        allergies: "",
    },
    {
        id: "c2",
        firstName: "Кирилл",
        lastName: "Захаров",
        phone: "+7 903 187-54-20",
        email: "kirill.zaharov@mail.ru",
        dateOfBirth: "1998-08-30",
        totalAppointments: 5,
        totalReservations: 3,
        lastVisit: "2025-07-14",
        createdAt: "2024-06-05",
        notes: "Коллекционирует пирсинг хряща",
        allergies: "",
    },
    {
        id: "c3",
        firstName: "Мария",
        lastName: "Соколова",
        phone: "+7 925 312-90-44",
        email: "maria.sokolova@yandex.ru",
        dateOfBirth: "2000-03-17",
        totalAppointments: 2,
        totalReservations: 1,
        lastVisit: "2025-07-14",
        createdAt: "2025-02-11",
        notes: "",
        allergies: "Никель",
    },
    {
        id: "c4",
        firstName: "Дмитрий",
        lastName: "Орлов",
        phone: "+7 912 678-22-15",
        email: "dmitry.orlov@gmail.com",
        dateOfBirth: "1995-11-04",
        totalAppointments: 8,
        totalReservations: 5,
        lastVisit: "2025-07-15",
        createdAt: "2023-09-14",
        notes: "Опытный клиент, доверяет выбору мастера",
        allergies: "",
    },
    {
        id: "c5",
        firstName: "Арина",
        lastName: "Новикова",
        phone: "+7 988 541-67-33",
        email: "arina.novikova@gmail.com",
        dateOfBirth: "2003-07-22",
        totalAppointments: 1,
        totalReservations: 1,
        lastVisit: "2025-07-15",
        createdAt: "2025-07-01",
        notes: "Первый пирсинг",
        allergies: "",
    },
    {
        id: "c6",
        firstName: "Сергей",
        lastName: "Петров",
        phone: "+7 917 892-11-48",
        email: "sergei.petrov@mail.ru",
        dateOfBirth: "1993-02-28",
        totalAppointments: 4,
        totalReservations: 2,
        lastVisit: "2025-07-16",
        createdAt: "2024-03-08",
        notes: "",
        allergies: "",
    },
    {
        id: "c7",
        firstName: "Валерия",
        lastName: "Морозова",
        phone: "+7 906 234-85-62",
        email: "valeria.morozova@yandex.ru",
        dateOfBirth: "1999-10-15",
        totalAppointments: 6,
        totalReservations: 4,
        lastVisit: "2025-07-17",
        createdAt: "2024-01-19",
        notes: "VIP. Постоянно заказывает золото 14к",
        allergies: "",
    },
    {
        id: "c8",
        firstName: "Иван",
        lastName: "Смирнов",
        phone: "+7 967 445-29-87",
        email: "ivan.smirnov@gmail.com",
        dateOfBirth: "1996-06-09",
        totalAppointments: 2,
        totalReservations: 2,
        lastVisit: "2025-07-18",
        createdAt: "2024-12-03",
        notes: "",
        allergies: "",
    },
    {
        id: "c9",
        firstName: "Екатерина",
        lastName: "Лебедева",
        phone: "+7 919 672-38-14",
        email: "ekaterina.lebedeva@mail.ru",
        dateOfBirth: "2002-01-31",
        totalAppointments: 3,
        totalReservations: 0,
        lastVisit: "2025-07-19",
        createdAt: "2025-04-22",
        notes: "Предпочитает маленькие украшения",
        allergies: "",
    },
    {
        id: "c10",
        firstName: "Алексей",
        lastName: "Попов",
        phone: "+7 931 117-60-25",
        email: "aleksei.popov@yandex.ru",
        dateOfBirth: "1990-09-06",
        totalAppointments: 7,
        totalReservations: 3,
        lastVisit: "2025-07-21",
        createdAt: "2023-07-14",
        notes: "Опытный. Делал пирсинг 7 раз.",
        allergies: "",
    },
];

// ── Blog posts ────────────────────────────────────────────────────────────────

export const mockBlogPosts: BlogPost[] = [
    {
        id: "b1",
        title: "Как выбрать украшение для первого пирсинга",
        slug: "kak-vybrat-ukrasheniye-dlya-pervogo-pirsinga",
        status: "published",
        views: 1840,
        createdAt: "2025-05-10",
        publishedAt: "2025-05-12",
        excerpt:
            "Первый пирсинг — ответственный шаг. Разбираемся, какой металл выбрать, какой размер подойдёт и на что обратить внимание при покупке украшения.",
    },
    {
        id: "b2",
        title: "Уход за пирсингом: первые 6 недель",
        slug: "ukhod-za-pirsingom-pervye-6-nedel",
        status: "published",
        views: 3210,
        createdAt: "2025-04-01",
        publishedAt: "2025-04-03",
        excerpt:
            "Правильный уход в первые недели — залог быстрого заживления. Пошаговая инструкция от мастера: что делать, чего избегать и когда можно менять украшение.",
    },
    {
        id: "b3",
        title: "Имплантат-сталь: что это и почему это важно",
        slug: "implantat-stal-chto-eto-i-pochemu-eto-vazhno",
        status: "published",
        views: 965,
        createdAt: "2025-06-15",
        publishedAt: "2025-06-17",
        excerpt:
            "Не всякая сталь одинакова. Объясняем, в чём разница между обычной нержавейкой и сталью класса имплантат, и почему это критически важно для свежего пирсинга.",
    },
    {
        id: "b4",
        title: "Хрящевой пирсинг уха: виды и особенности заживления",
        slug: "khryashchevoy-pirsing-ukha-vidy-i-osobennosti-zazhivleniya",
        status: "draft",
        views: 0,
        createdAt: "2025-07-10",
        publishedAt: "",
        excerpt:
            "Хеликс, трагус, конча, дайс — разбираемся в видах хрящевого пирсинга уха, сроках заживления и выборе украшений для каждой зоны.",
    },
];

// ── Activity feed ─────────────────────────────────────────────────────────────

export const mockActivity: ActivityItem[] = [
    {
        id: "act1",
        type: "reservation_created",
        text: "Создана бронь #PK-RES-2025-0042 — Анастасия Волкова",
        time: "12 минут назад",
        dotColor: "magenta",
    },
    {
        id: "act2",
        type: "appointment_booked",
        text: "Новая запись: Кирилл Захаров — Пирсинг хряща, 14 июля 13:30",
        time: "1 час назад",
        dotColor: "green",
    },
    {
        id: "act3",
        type: "reservation_confirmed",
        text: "Бронь #PK-RES-2025-0041 подтверждена",
        time: "2 часа назад",
        dotColor: "green",
    },
    {
        id: "act4",
        type: "appointment_completed",
        text: "Запись завершена: Мария Соколова — Пирсинг ноздри",
        time: "3 часа назад",
        dotColor: "green",
    },
    {
        id: "act5",
        type: "client_registered",
        text: "Новый клиент зарегистрирован: Арина Новикова",
        time: "5 часов назад",
        dotColor: "amber",
    },
    {
        id: "act6",
        type: "product_updated",
        text: "Товар обновлён: «Штанга изогнутая PVD» — остаток 2 шт.",
        time: "вчера, 18:44",
        dotColor: "amber",
    },
    {
        id: "act7",
        type: "reservation_created",
        text: "Создана бронь #PK-RES-2025-0041 — Дмитрий Орлов",
        time: "вчера, 16:45",
        dotColor: "magenta",
    },
    {
        id: "act8",
        type: "appointment_booked",
        text: "Новая запись: Валерия Морозова — Пирсинг мочки уха, 17 июля",
        time: "вчера, 14:20",
        dotColor: "green",
    },
    {
        id: "act9",
        type: "reservation_confirmed",
        text: "Бронь #PK-RES-2025-0038 подтверждена — Арина Новикова",
        time: "вчера, 10:05",
        dotColor: "green",
    },
    {
        id: "act10",
        type: "product_updated",
        text: "Опубликован новый товар: «Стад с белым CZ»",
        time: "2 дня назад",
        dotColor: "gray",
    },
];

// ── Dashboard stats ───────────────────────────────────────────────────────────

export const mockDashStats: DashStats = {
    appointmentsToday: 4,
    appointmentsDelta: "+1 к вчерашнему",
    activeReservations: 7,
    reservationsDelta: "+3 за сутки",
    catalogItems: 10,
    catalogDelta: "без изменений",
    totalClients: 47,
    clientsDelta: "+2 за неделю",
};

// ── Helpers ───────────────────────────────────────────────────────────────────

export const MATERIAL_LABELS: Record<MaterialType, string> = {
    titanium: "Титан",
    gold_14k: "Золото 14к",
    gold_18k: "Золото 18к",
    implant_steel: "Сталь имплантат",
    niobium: "Ниобий",
};

export const TYPE_LABELS: Record<JewelryType, string> = {
    stud: "Стад",
    hoop: "Кольцо",
    barbell: "Штанга",
    labret: "Лабрет",
    segment_ring: "Сегментное кольцо",
    captive_ring: "Кольцо с шариком",
    threadless: "Резьба без резьбы",
};

export const STATUS_LABELS: Record<AppointmentStatus, string> = {
    pending: "Ожидает",
    confirmed: "Подтверждена",
    completed: "Завершена",
    cancelled: "Отменена",
    no_show: "Не пришёл",
};

export const RES_STATUS_LABELS: Record<ReservationStatus, string> = {
    pending: "Ожидает",
    confirmed: "Подтверждена",
    picked_up: "Забрано",
    expired: "Истекла",
    cancelled: "Отменена",
};

// ── 3D Asset Types ────────────────────────────────────────────────────────────

export type BodyModelArea = "ear" | "nose" | "lip" | "eyebrow" | "navel" | "face";
export type BodyModelSide = "left" | "right" | null;
export type Jewelry3dStatus = "active" | "inactive" | "processing";
export type Jewelry3dType = "ring" | "barbell" | "labret" | "stud" | "hoop" | "clicker" | "chain";

export interface MockBodyModel {
    id: string;
    name: string;
    area: BodyModelArea;
    side: BodyModelSide;
    modelUrl: string;
    modelUrlLod1: string | null;
    modelUrlLod2: string | null;
    thumbnailUrl: string | null;
    polygonCount: number;
    fileSizeBytes: number;
    cameraDefaults: {
        position: [number, number, number];
        target: [number, number, number];
        fov: number;
    };
    skinTextures: unknown[];
    version: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface MockPiercingPoint {
    id: string;
    bodyModelId: string;
    name: string;
    displayName: string;
    positionX: number;
    positionY: number;
    positionZ: number;
    rotationX: number;
    rotationY: number;
    rotationZ: number;
    normalX: number;
    normalY: number;
    normalZ: number;
    compatibleJewelryTypes: Jewelry3dType[];
    compatibleGauges: string[] | null;
    maxJewelryDiameterMm: number | null;
    sortOrder: number;
    isActive: boolean;
    createdAt: string;
    updatedAt: string;
}

export interface MockJewelry3dModel {
    id: string;
    productId: string;
    modelUrl: string;
    thumbnailUrl: string | null;
    polygonCount: number | null;
    fileSizeBytes: number | null;
    materialMapping: Record<string, unknown>;
    jewelryType: Jewelry3dType;
    defaultAttachment: string | null;
    isValidated: boolean;
    validationErrors: string[];
    status: Jewelry3dStatus;
    createdAt: string;
    updatedAt: string;
}

export interface MockAftercareGuide {
    id: string;
    title: string;
    sections: { heading: string; body: string }[];
    updatedAt: string;
}

// ── Body Models ───────────────────────────────────────────────────────────────

export const mockBodyModels: MockBodyModel[] = [
    {
        id: "bm1",
        name: "Ухо левое (стандарт)",
        area: "ear",
        side: "left",
        modelUrl: "https://cdn.piercerkzn.ru/models/ear_left_v2.glb",
        modelUrlLod1: "https://cdn.piercerkzn.ru/models/ear_left_v2_lod1.glb",
        modelUrlLod2: "https://cdn.piercerkzn.ru/models/ear_left_v2_lod2.glb",
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/ear_left.webp",
        polygonCount: 72000,
        fileSizeBytes: 2450000,
        cameraDefaults: { position: [0, 0.5, 3], target: [0, 0, 0], fov: 45 },
        skinTextures: [],
        version: 2,
        isActive: true,
        createdAt: "2025-03-01T10:00:00Z",
        updatedAt: "2025-05-15T14:30:00Z",
    },
    {
        id: "bm2",
        name: "Нос фронтальный",
        area: "nose",
        side: null,
        modelUrl: "https://cdn.piercerkzn.ru/models/nose_front_v1.glb",
        modelUrlLod1: "https://cdn.piercerkzn.ru/models/nose_front_v1_lod1.glb",
        modelUrlLod2: null,
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/nose_front.webp",
        polygonCount: 58000,
        fileSizeBytes: 1980000,
        cameraDefaults: { position: [0, 0, 2.5], target: [0, 0.1, 0], fov: 40 },
        skinTextures: [],
        version: 1,
        isActive: true,
        createdAt: "2025-04-10T08:00:00Z",
        updatedAt: "2025-04-10T08:00:00Z",
    },
    {
        id: "bm3",
        name: "Губа нижняя",
        area: "lip",
        side: null,
        modelUrl: "https://cdn.piercerkzn.ru/models/lip_lower_v1.glb",
        modelUrlLod1: null,
        modelUrlLod2: null,
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/lip_lower.webp",
        polygonCount: 65000,
        fileSizeBytes: 2100000,
        cameraDefaults: { position: [0, -0.3, 2], target: [0, -0.2, 0], fov: 50 },
        skinTextures: [],
        version: 1,
        isActive: false,
        createdAt: "2025-05-20T12:00:00Z",
        updatedAt: "2025-06-01T09:15:00Z",
    },
    {
        id: "bm4",
        name: "Ухо правое (стандарт)",
        area: "ear",
        side: "right",
        modelUrl: "https://cdn.piercerkzn.ru/models/ear_right_v2.glb",
        modelUrlLod1: "https://cdn.piercerkzn.ru/models/ear_right_v2_lod1.glb",
        modelUrlLod2: "https://cdn.piercerkzn.ru/models/ear_right_v2_lod2.glb",
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/ear_right.webp",
        polygonCount: 72000,
        fileSizeBytes: 2460000,
        cameraDefaults: { position: [0, 0.5, 3], target: [0, 0, 0], fov: 45 },
        skinTextures: [],
        version: 2,
        isActive: true,
        createdAt: "2025-03-01T10:30:00Z",
        updatedAt: "2025-05-15T14:30:00Z",
    },
];

// ── Jewelry 3D Models ─────────────────────────────────────────────────────────

export const mockJewelry3dModels: MockJewelry3dModel[] = [
    {
        id: "j3d1",
        productId: "p1",
        modelUrl: "https://cdn.piercerkzn.ru/models/jewelry/segment_ring_8mm.glb",
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/jewelry/segment_ring_8mm.webp",
        polygonCount: 12000,
        fileSizeBytes: 480000,
        materialMapping: { mesh_body: { polished_titanium: "var_01" } },
        jewelryType: "ring",
        defaultAttachment: "helix_upper_1",
        isValidated: true,
        validationErrors: [],
        status: "active",
        createdAt: "2025-03-15T10:00:00Z",
        updatedAt: "2025-03-15T10:00:00Z",
    },
    {
        id: "j3d2",
        productId: "p2",
        modelUrl: "https://cdn.piercerkzn.ru/models/jewelry/labret_opal.glb",
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/jewelry/labret_opal.webp",
        polygonCount: 8500,
        fileSizeBytes: 320000,
        materialMapping: { mesh_body: { gold_14k: "var_01" }, gem_opal: { rainbow: "var_01" } },
        jewelryType: "labret",
        defaultAttachment: "labret_center",
        isValidated: false,
        validationErrors: [
            "Нормали перевёрнуты на 3 полигонах",
            "Отсутствует UV-развёртка для gem_opal",
        ],
        status: "inactive",
        createdAt: "2025-04-05T14:00:00Z",
        updatedAt: "2025-04-20T11:30:00Z",
    },
    {
        id: "j3d3",
        productId: "p3",
        modelUrl: "https://cdn.piercerkzn.ru/models/jewelry/barbell_16g.glb",
        thumbnailUrl: null,
        polygonCount: 6200,
        fileSizeBytes: 210000,
        materialMapping: { mesh_body: { polished_titanium: "var_01" } },
        jewelryType: "barbell",
        defaultAttachment: "helix_mid_1",
        isValidated: true,
        validationErrors: [],
        status: "active",
        createdAt: "2025-02-20T09:00:00Z",
        updatedAt: "2025-02-20T09:00:00Z",
    },
    {
        id: "j3d4",
        productId: "p5",
        modelUrl: "https://cdn.piercerkzn.ru/models/jewelry/stud_cz_white.glb",
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/jewelry/stud_cz_white.webp",
        polygonCount: null,
        fileSizeBytes: null,
        materialMapping: {},
        jewelryType: "stud",
        defaultAttachment: "lobe_1",
        isValidated: false,
        validationErrors: ["Файл загружен, ожидает валидации"],
        status: "processing",
        createdAt: "2025-07-01T16:00:00Z",
        updatedAt: "2025-07-01T16:00:00Z",
    },
    {
        id: "j3d5",
        productId: "p4",
        modelUrl: "https://cdn.piercerkzn.ru/models/jewelry/hoop_hinge_10mm.glb",
        thumbnailUrl: "https://cdn.piercerkzn.ru/thumbs/jewelry/hoop_hinge_10mm.webp",
        polygonCount: 9800,
        fileSizeBytes: 390000,
        materialMapping: { mesh_body: { implant_steel: "var_01" } },
        jewelryType: "hoop",
        defaultAttachment: "helix_upper_1",
        isValidated: true,
        validationErrors: [],
        status: "active",
        createdAt: "2025-04-18T11:00:00Z",
        updatedAt: "2025-04-18T11:00:00Z",
    },
];

// ── Piercing Points (Anchors) ─────────────────────────────────────────────────

export const mockPiercingPoints: MockPiercingPoint[] = [
    {
        id: "pp1",
        bodyModelId: "bm1",
        name: "helix_upper_1",
        displayName: "Хеликс верхний",
        positionX: 1.2345,
        positionY: 3.4567,
        positionZ: 0.1234,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 15.5,
        normalX: 0.7071,
        normalY: 0.7071,
        normalZ: 0,
        compatibleJewelryTypes: ["ring", "barbell", "clicker"],
        compatibleGauges: ["18g", "16g"],
        maxJewelryDiameterMm: 10,
        sortOrder: 1,
        isActive: true,
        createdAt: "2025-03-05T10:00:00Z",
        updatedAt: "2025-03-05T10:00:00Z",
    },
    {
        id: "pp2",
        bodyModelId: "bm1",
        name: "helix_mid_1",
        displayName: "Хеликс средний",
        positionX: 1.1023,
        positionY: 2.8901,
        positionZ: 0.0987,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 10.2,
        normalX: 0.6543,
        normalY: 0.7561,
        normalZ: 0,
        compatibleJewelryTypes: ["ring", "barbell", "stud"],
        compatibleGauges: ["18g", "16g", "14g"],
        maxJewelryDiameterMm: 8,
        sortOrder: 2,
        isActive: true,
        createdAt: "2025-03-05T10:05:00Z",
        updatedAt: "2025-03-05T10:05:00Z",
    },
    {
        id: "pp3",
        bodyModelId: "bm1",
        name: "lobe_1",
        displayName: "Мочка основная",
        positionX: 0.8765,
        positionY: 1.234,
        positionZ: 0.21,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        normalX: 0.5,
        normalY: 0.866,
        normalZ: 0,
        compatibleJewelryTypes: ["stud", "ring", "hoop", "labret"],
        compatibleGauges: ["20g", "18g", "16g"],
        maxJewelryDiameterMm: 12,
        sortOrder: 3,
        isActive: true,
        createdAt: "2025-03-05T10:10:00Z",
        updatedAt: "2025-03-05T10:10:00Z",
    },
    {
        id: "pp4",
        bodyModelId: "bm1",
        name: "tragus_1",
        displayName: "Трагус",
        positionX: 0.5432,
        positionY: 2.1098,
        positionZ: 0.4321,
        rotationX: 5.0,
        rotationY: 0,
        rotationZ: -8.3,
        normalX: -0.3,
        normalY: 0.9539,
        normalZ: 0,
        compatibleJewelryTypes: ["labret", "stud", "barbell"],
        compatibleGauges: ["18g", "16g"],
        maxJewelryDiameterMm: 6,
        sortOrder: 4,
        isActive: true,
        createdAt: "2025-03-05T10:15:00Z",
        updatedAt: "2025-03-05T10:15:00Z",
    },
    {
        id: "pp5",
        bodyModelId: "bm2",
        name: "nostril_left_1",
        displayName: "Ноздря левая",
        positionX: -0.4512,
        positionY: 0.321,
        positionZ: 1.0987,
        rotationX: 0,
        rotationY: 30.0,
        rotationZ: 0,
        normalX: -0.5,
        normalY: 0.2,
        normalZ: 0.8432,
        compatibleJewelryTypes: ["stud", "ring", "hoop"],
        compatibleGauges: ["20g", "18g"],
        maxJewelryDiameterMm: 8,
        sortOrder: 1,
        isActive: true,
        createdAt: "2025-04-12T09:00:00Z",
        updatedAt: "2025-04-12T09:00:00Z",
    },
    {
        id: "pp6",
        bodyModelId: "bm2",
        name: "septum_center",
        displayName: "Перегородка",
        positionX: 0,
        positionY: -0.1234,
        positionZ: 0.8765,
        rotationX: 90.0,
        rotationY: 0,
        rotationZ: 0,
        normalX: 0,
        normalY: -1,
        normalZ: 0,
        compatibleJewelryTypes: ["ring", "clicker", "barbell"],
        compatibleGauges: ["16g", "14g"],
        maxJewelryDiameterMm: 10,
        sortOrder: 2,
        isActive: true,
        createdAt: "2025-04-12T09:05:00Z",
        updatedAt: "2025-04-12T09:05:00Z",
    },
    {
        id: "pp7",
        bodyModelId: "bm3",
        name: "labret_center",
        displayName: "Лабрет центральный",
        positionX: 0,
        positionY: -0.5678,
        positionZ: 0.9876,
        rotationX: 0,
        rotationY: 0,
        rotationZ: 0,
        normalX: 0,
        normalY: -0.3,
        normalZ: 0.9539,
        compatibleJewelryTypes: ["labret", "stud"],
        compatibleGauges: ["16g", "14g"],
        maxJewelryDiameterMm: 6,
        sortOrder: 1,
        isActive: true,
        createdAt: "2025-05-22T12:00:00Z",
        updatedAt: "2025-05-22T12:00:00Z",
    },
];

// ── Aftercare Guides ──────────────────────────────────────────────────────────

export const mockAftercareGuides: MockAftercareGuide[] = [
    {
        id: "ag1",
        title: "Уход за пирсингом мочки уха",
        sections: [
            {
                heading: "Первые 24 часа",
                body: "Не трогайте украшение руками. Избегайте контакта с водой из открытых водоёмов. При необходимости промойте физраствором.",
            },
            {
                heading: "Первая неделя",
                body: "Обрабатывайте место прокола хлоргексидином 2 раза в день. Не снимайте украшение. Спите на противоположной стороне.",
            },
            {
                heading: "Полное заживление",
                body: "Мочка уха заживает 4–6 недель. После полного заживления можно менять украшение. При покраснении или выделениях обратитесь к мастеру.",
            },
        ],
        updatedAt: "2025-06-01T10:00:00Z",
    },
    {
        id: "ag2",
        title: "Уход за пирсингом хряща",
        sections: [
            {
                heading: "Первые 48 часов",
                body: "Отёк — нормальная реакция. Приложите холод через чистую ткань на 5 минут. Не спите на стороне прокола.",
            },
            {
                heading: "Ежедневный уход",
                body: "Промывайте физраствором (NaCl 0.9%) утром и вечером. Не используйте спирт или перекись водорода. Не прокручивайте украшение.",
            },
            {
                heading: "Сроки заживления",
                body: "Хрящ заживает 3–6 месяцев. Не меняйте украшение раньше срока. Избегайте бассейнов и саун первые 2 месяца.",
            },
            {
                heading: "Когда обращаться к мастеру",
                body: "Если появился сильный отёк, гнойные выделения, повышение температуры в зоне прокола или украшение начало «врастать» — обратитесь к мастеру немедленно.",
            },
        ],
        updatedAt: "2025-06-10T14:30:00Z",
    },
    {
        id: "ag3",
        title: "Уход за пирсингом носа",
        sections: [
            {
                heading: "Сразу после процедуры",
                body: "Возможно лёгкое кровотечение в первые часы — это нормально. Не сморкайтесь резко. Промойте нос физраствором.",
            },
            {
                heading: "Первые 2 недели",
                body: "Обрабатывайте снаружи хлоргексидином. Внутри — промывание физраствором. Избегайте макияжа в зоне прокола.",
            },
            {
                heading: "Заживление и смена украшения",
                body: "Ноздря заживает 2–4 месяца, перегородка — 6–8 месяцев. Первую замену украшения лучше делать у мастера.",
            },
        ],
        updatedAt: "2025-05-20T09:00:00Z",
    },
];

// ── 3D Asset Labels ───────────────────────────────────────────────────────────

export const BODY_MODEL_AREA_LABELS: Record<BodyModelArea, string> = {
    ear: "Ухо",
    nose: "Нос",
    lip: "Губа",
    eyebrow: "Бровь",
    navel: "Пупок",
    face: "Лицо",
};

export const JEWELRY_3D_TYPE_LABELS: Record<Jewelry3dType, string> = {
    ring: "Кольцо",
    barbell: "Штанга",
    labret: "Лабрет",
    stud: "Стад",
    hoop: "Хуп",
    clicker: "Кликер",
    chain: "Цепочка",
};

export const JEWELRY_3D_STATUS_LABELS: Record<Jewelry3dStatus, string> = {
    active: "Активна",
    inactive: "Неактивна",
    processing: "Обработка",
};
