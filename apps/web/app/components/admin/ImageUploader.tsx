import { useState, useRef } from "react";
import {
  type AdminUploadLocation,
  type AllowedStaticImageId,
  type UploadedMediaMetadata,
  DEFAULT_LOCATION_IMAGES,
  resolveAllowedImage,
} from "../../lib/site-content.shared";
import styles from "./ImageUploader.module.css";

export interface ImageUploaderProps {
  csrfToken: string;
  revision: string;
  location: AdminUploadLocation;
  currentImageId: string;
  mediaMetadata?: UploadedMediaMetadata | null;
  alt: string;
  disabled?: boolean;
  isGlobalUploading: boolean;
  setIsGlobalUploading: (uploading: boolean) => void;
  onSuccess: (newRevision: string, newImageId: string, metadata: UploadedMediaMetadata) => void;
  onRevertSuccess: (newRevision: string, defaultImageId: AllowedStaticImageId) => void;
  label?: string;
  aspect?: "hero" | "portrait" | "standard";
}

export function ImageUploader({
  csrfToken,
  revision,
  location,
  currentImageId,
  alt,
  disabled = false,
  isGlobalUploading,
  setIsGlobalUploading,
  onSuccess,
  onRevertSuccess,
  label = "Image",
  aspect = "standard",
}: ImageUploaderProps) {
  const [isUploading, setIsUploading] = useState(false);
  const [feedback, setFeedback] = useState<{
    type: "loading" | "success" | "error";
    message: string;
  } | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const defaultStaticId = DEFAULT_LOCATION_IMAGES[location];
  const isCustomImage =
    /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(currentImageId);

  const isAspectPortrait = aspect === "portrait" || location.startsWith("portrait_");
  const isAspectHero = aspect === "hero" || location === "showreel_cover";

  const previewSrc = isCustomImage
    ? `/media/site/${location}/${currentImageId}/640p/webp`
    : resolveAllowedImage(currentImageId) || resolveAllowedImage(defaultStaticId) || "";

  const handleUpload = async (file: File) => {
    if (disabled || isUploading || isGlobalUploading) return;

    setFeedback({
      type: "loading",
      message: "Import et traitement de l'image en cours (génération des variantes WebP et AVIF)...",
    });
    setIsUploading(true);
    setIsGlobalUploading(true);

    try {
      const formData = new FormData();
      formData.append("file", file);

      const res = await fetch("/api/admin/media-upload", {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "x-content-revision": revision,
          "x-media-location": location,
        },
        body: formData,
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setFeedback({
          type: "success",
          message:
            "Image importée et enregistrée immédiatement. Les textes et textes alternatifs (alt) sont enregistrés avec le bouton « Enregistrer » du formulaire ci-dessous.",
        });
        onSuccess(data.newRevision, data.imageId, data.mediaMetadata);
      } else {
        setFeedback({
          type: "error",
          message: data.error || "Erreur lors de l'import de l'image.",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Erreur de connexion lors de l'envoi de l'image. Veuillez vérifier votre réseau.",
      });
    } finally {
      setIsUploading(false);
      setIsGlobalUploading(false);
      // Reset input value so the same file can be selected again
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    }
  };

  const handleRevert = async () => {
    if (disabled || isUploading || isGlobalUploading) return;

    setFeedback({
      type: "loading",
      message: "Rétablissement de l'image de référence...",
    });
    setIsUploading(true);
    setIsGlobalUploading(true);

    try {
      const res = await fetch("/api/admin/media-upload", {
        method: "POST",
        headers: {
          "x-csrf-token": csrfToken,
          "x-content-revision": revision,
          "x-media-location": location,
          "x-media-action": "revert",
        },
      });

      const data = await res.json();

      if (res.ok && data.success) {
        setFeedback({
          type: "success",
          message:
            "Image de référence rétablie avec succès. Pensez à enregistrer vos textes si nécessaire.",
        });
        onRevertSuccess(data.newRevision, defaultStaticId);
      } else {
        setFeedback({
          type: "error",
          message: data.error || "Erreur lors du rétablissement de l'image de référence.",
        });
      }
    } catch {
      setFeedback({
        type: "error",
        message: "Erreur de connexion lors du rétablissement de l'image de référence.",
      });
    } finally {
      setIsUploading(false);
      setIsGlobalUploading(false);
    }
  };

  const onFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      void handleUpload(file);
    }
  };

  const isDisabled = disabled || isUploading || isGlobalUploading;

  return (
    <div className={styles.container}>
      {/* Thumbnail preview */}
      <div
        className={`${styles.previewWrapper} ${
          isAspectPortrait ? styles.aspectPortrait : isAspectHero ? styles.aspectHero : ""
        }`}
      >
        {previewSrc ? (
          <img
            src={previewSrc}
            alt={alt || label}
            className={styles.previewImg}
            data-testid={`image-preview-${location}`}
          />
        ) : (
          <div className={styles.fileRequirements}>Aucune image</div>
        )}
        <span
          className={`${styles.badge} ${
            isCustomImage ? styles.badgeCustom : styles.badgeDefault
          }`}
        >
          {isCustomImage ? "Image importée" : "Image de référence"}
        </span>
      </div>

      <p className={styles.fileRequirements}>
        Formats acceptés : JPEG, PNG, WebP · Taille maximale : 25 Mo (variantes générées
        automatiquement sans recadrage destructif)
      </p>

      {/* Action buttons */}
      <div className={styles.actionsRow}>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/jpeg,image/png,image/webp"
          className={styles.hiddenFileInput}
          onChange={onFileInputChange}
          disabled={isDisabled}
          tabIndex={-1}
          aria-hidden="true"
        />

        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isDisabled}
          className={styles.uploadButton}
          aria-label={`${isCustomImage ? "Remplacer l'image" : "Importer une image"} pour ${label}`}
        >
          {isCustomImage ? "Remplacer l'image" : "Importer une image"}
        </button>

        {isCustomImage && (
          <button
            type="button"
            onClick={() => void handleRevert()}
            disabled={isDisabled}
            className={styles.revertButton}
            aria-label={`Revenir à l'image de référence pour ${label}`}
          >
            Revenir à l'image de référence
          </button>
        )}
      </div>

      {/* Accessible feedback messages */}
      {feedback && (
        <div
          role={feedback.type === "error" ? "alert" : "status"}
          aria-live="polite"
          className={`${styles.statusMessage} ${
            feedback.type === "loading"
              ? styles.statusLoading
              : feedback.type === "success"
                ? styles.statusSuccess
                : styles.statusError
          }`}
        >
          {feedback.type === "loading" && <span className={styles.spinner} aria-hidden="true" />}
          {feedback.message}
        </div>
      )}
    </div>
  );
}
