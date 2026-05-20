"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import styles from "./login.module.css";

export default function AdminLoginPage() {
    const router = useRouter();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState("");
    const [loading, setLoading] = useState(false);

    const handleSubmit = async (e: FormEvent) => {
        e.preventDefault();
        setError("");
        setLoading(true);

        await new Promise((r) => setTimeout(r, 400));

        if (email === "admin" && password === "admin") {
            localStorage.setItem("admin_auth", "1");
            router.replace("/admin");
        } else {
            setError("Неверные учётные данные");
            setLoading(false);
        }
    };

    return (
        <div className={styles.page}>
            <div className={styles.card}>
                <p className={styles.logo}>PIERCER·KZN</p>
                <span className={styles.sub}>Панель управления</span>

                <form className={styles.form} onSubmit={handleSubmit}>
                    {error && <p className={styles.error}>{error}</p>}

                    <div className={styles.group}>
                        <label className={styles.label} htmlFor="email">
                            Логин
                        </label>
                        <input
                            id="email"
                            type="text"
                            className={styles.input}
                            value={email}
                            onChange={(e) => setEmail(e.target.value)}
                            placeholder="admin"
                            autoComplete="username"
                            autoFocus
                        />
                    </div>

                    <div className={styles.group}>
                        <label className={styles.label} htmlFor="password">
                            Пароль
                        </label>
                        <input
                            id="password"
                            type="password"
                            className={styles.input}
                            value={password}
                            onChange={(e) => setPassword(e.target.value)}
                            placeholder="••••••"
                            autoComplete="current-password"
                        />
                    </div>

                    <button type="submit" className={styles.btn} disabled={loading}>
                        {loading ? "Вход..." : "Войти"}
                    </button>
                </form>

                <p className={styles.hint}>demo: admin / admin</p>
            </div>
        </div>
    );
}
