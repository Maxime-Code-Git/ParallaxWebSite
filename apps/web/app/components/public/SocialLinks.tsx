import { getParallaxSocialProfiles, type SocialProfileUrls } from "../../lib/social-profiles";
import styles from "./socialLinks.module.css";

export function SocialLinks({
  profiles,
  label,
  theme = "dark",
}: {
  profiles: SocialProfileUrls;
  label: string;
  theme?: "dark" | "sempra";
}) {
  const { instagramUrl, youtubeUrl } = getParallaxSocialProfiles(profiles);
  if (!instagramUrl && !youtubeUrl) return null;

  return (
    <nav aria-label={label} className={theme === "sempra" ? `${styles.links} ${styles.sempra}` : styles.links}>
      {instagramUrl && (
        <a className={styles.link} href={instagramUrl} target="_blank" rel="noopener noreferrer">
          <svg className={styles.instagram} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true">
            <rect x="3" y="3" width="18" height="18" rx="5" />
            <circle cx="12" cy="12" r="4" />
            <circle cx="17.5" cy="6.5" r="1" stroke="none" fill="currentColor" />
          </svg>
          Instagram
        </a>
      )}
      {youtubeUrl && (
        <a className={styles.link} href={youtubeUrl} target="_blank" rel="noopener noreferrer">
          <svg className={styles.youtube} viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <rect x="1" y="4" width="22" height="16" rx="4" fill="currentColor" />
            <path d="M10 8.5 16 12 10 15.5Z" fill="white" />
          </svg>
          YouTube
        </a>
      )}
    </nav>
  );
}
