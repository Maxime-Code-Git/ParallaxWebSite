import type { Route } from "./+types/home";
import styles from "./home.module.css";

export function meta(_args: Route.MetaArgs) {
  return [
    { title: "Parallax" },
    { name: "description", content: "Parallax - socle technique" },
  ];
}

export default function Home() {
  return (
    <main className={styles.container}>
      <h1 className={styles.title}>Parallax - socle technique</h1>
    </main>
  );
}
