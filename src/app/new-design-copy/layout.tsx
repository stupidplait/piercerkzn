import { Syne } from "next/font/google";

const display = Syne({
    variable: "--font-display-new",
    subsets: ["latin", "latin-ext"],
    weight: ["400", "600", "700", "800"],
    display: "swap",
});

export default function NewDesignCopyLayout({ children }: { children: React.ReactNode }) {
    return <div className={display.variable}>{children}</div>;
}
