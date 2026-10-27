import { useState, useRef, useEffect, useCallback } from "react";
import styles from "../../routes/admin/galleries.module.css";
import type { UploadTarget } from "../../lib/gallery-upload.server";

export type UploadPhase = "init" | "chunk" | "status" | "finalize" | "scan";

export interface UploadQueueItem {
  id: string;
  file: File;
  target: UploadTarget;
  status: "pending" | "uploading" | "completed" | "error";
  progress: number; // 0 to 100
  uploadId?: string;
  phase?: UploadPhase;
  error?: string;
}

interface GalleryBrowserUploadProps {
  galleryId: string;
  csrfToken: string;
  galleryFolderName: string;
  onUploadBatchComplete: (folderName: string) => void;
}

const CHUNK_SIZE = 5 * 1024 * 1024; // 5 MB
const PHOTO_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp", ".avif"];
const VIDEO_EXTENSIONS = [".mp4", ".webm"];
export const MAX_BATCH_FILES = 2000;
const MAX_AUTO_RETRIES = 3;

/**
 * Determines whether an error is transient (network failure, AbortError, 408, 429, 5xx)
 * or permanent (400, 401, 403, 413, 415).
 */
export function isTransientError(status?: number, err?: unknown): boolean {
  if (err instanceof TypeError || (err instanceof Error && err.name === "TypeError")) {
    return true; // Network failure in browser fetch
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    return true;
  }
  if (err instanceof Error && err.name === "AbortError") {
    return true;
  }
  if (!status) return true;
  if (status === 408 || status === 429 || (status >= 500 && status <= 599)) {
    return true;
  }
  return false;
}

export function formatPhase(phase?: UploadPhase): string {
  switch (phase) {
    case "init":
      return "Initialisation";
    case "chunk":
      return "Envoi des morceaux";
    case "status":
      return "Vérification";
    case "finalize":
      return "Finalisation";
    case "scan":
      return "Analyse";
    default:
      return "Transfert";
  }
}

/**
 * Executes a fetch request with bounded automatic retries and exponential backoff (1s, 2s, 4s + jitter)
 * for transient errors only. Permanent errors fail immediately.
 */
async function fetchWithRetry(
  url: string,
  options: RequestInit,
  phase: UploadPhase,
  maxRetries = MAX_AUTO_RETRIES
): Promise<Response> {
  let attempt = 0;
  while (true) {
    try {
      const res = await fetch(url, options);
      if (!res.ok) {
        if (isTransientError(res.status) && attempt < maxRetries) {
          attempt++;
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) + Math.random() * 200;
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }
        const errData = (await res.json().catch(() => ({}))) as { error?: string };
        const msg = errData.error || `Erreur HTTP ${res.status}`;
        const err = new Error(msg);
        (err as unknown as { status?: number; phase?: UploadPhase }).status = res.status;
        (err as unknown as { status?: number; phase?: UploadPhase }).phase = phase;
        throw err;
      }
      return res;
    } catch (err: unknown) {
      const httpStatus = (err as unknown as { status?: number }).status;
      if (isTransientError(httpStatus, err) && attempt < maxRetries) {
        attempt++;
        const delay = Math.min(1000 * Math.pow(2, attempt - 1), 5000) + Math.random() * 200;
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      if ((err as unknown as { phase?: UploadPhase }).phase === undefined) {
        (err as unknown as { phase?: UploadPhase }).phase = phase;
      }
      throw err;
    }
  }
}

export function GalleryBrowserUpload({
  galleryId,
  csrfToken,
  galleryFolderName,
  onUploadBatchComplete,
}: GalleryBrowserUploadProps) {
  const [queue, setQueue] = useState<UploadQueueItem[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [batchCompleted, setBatchCompleted] = useState(false);
  const [batchError, setBatchError] = useState<string | null>(null);

  const queueRef = useRef<UploadQueueItem[]>([]);
  queueRef.current = queue;

  const isProcessingRef = useRef(false);
  const hasNotifiedBatchRef = useRef(false);

  const photoInputRef = useRef<HTMLInputElement>(null);
  const videoInputRef = useRef<HTMLInputElement>(null);
  const photosButtonRef = useRef<HTMLButtonElement>(null);
  const videosButtonRef = useRef<HTMLButtonElement>(null);

  // Warn before closing or refreshing if uploads are actively transferring
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (isProcessingRef.current) {
        e.preventDefault();
        e.returnValue = "Un upload est en cours. Êtes-vous sûr de vouloir quitter ?";
        return e.returnValue;
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, []);

  const addFilesToQueue = (files: FileList | File[], defaultTarget: UploadTarget) => {
    if (queueRef.current.length + files.length > MAX_BATCH_FILES) {
      setBatchError(`Limite dépassée : un lot ne peut pas contenir plus de ${MAX_BATCH_FILES} fichiers.`);
      return;
    }
    setBatchError(null);

    const newItems: UploadQueueItem[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      let target: UploadTarget = defaultTarget;
      const lower = file.name.toLowerCase();

      // Automatically categorize by extension if dropped
      if (PHOTO_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        target = "photos";
      } else if (VIDEO_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
        target = "videos";
      }

      newItems.push({
        id: `${file.name}-${file.size}-${Date.now()}-${Math.random()}`,
        file,
        target,
        status: "pending",
        progress: 0,
      });
    }

    if (newItems.length > 0) {
      hasNotifiedBatchRef.current = false;
      setBatchCompleted(false);
      setQueue((prev) => [...prev, ...newItems]);
    }
  };

  const uploadSingleFile = async (item: UploadQueueItem): Promise<void> => {
    const { file, target } = item;
    const totalChunks = Math.ceil(file.size / CHUNK_SIZE);

    item.status = "uploading";
    item.progress = 0;
    item.error = undefined;
    item.phase = "init";
    setQueue((prev) =>
      prev.map((q) =>
        q.id === item.id
          ? { ...q, status: "uploading", progress: 0, error: undefined, phase: "init" }
          : q
      )
    );

    let uploadId = item.uploadId;
    let uploadedChunks: number[];

    // Step 1: Init or check existing session
    if (!uploadId) {
      const initRes = await fetchWithRetry(
        `/api/admin/gallery-upload/${galleryId}?action=init`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-CSRF-Token": csrfToken,
          },
          body: JSON.stringify({
            action: "init",
            target,
            fileName: file.name,
            fileSize: file.size,
            totalChunks,
            chunkSize: CHUNK_SIZE,
          }),
        },
        "init"
      );

      const initData = (await initRes.json()) as { uploadId: string; uploadedChunks: number[] };
      uploadId = initData.uploadId;
      item.uploadId = uploadId;
      uploadedChunks = initData.uploadedChunks || [];

      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, uploadId } : q))
      );
    } else {
      item.phase = "status";
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, phase: "status" } : q))
      );

      const statusRes = await fetchWithRetry(
        `/api/admin/gallery-upload/${galleryId}?action=status&uploadId=${uploadId}`,
        {
          headers: {
            "X-CSRF-Token": csrfToken,
          },
        },
        "status"
      );
      const statusData = (await statusRes.json()) as { uploadedChunks: number[] };
      uploadedChunks = statusData.uploadedChunks || [];
    }

    const uploadedSet = new Set(uploadedChunks);

    // Step 2: Upload chunks
    item.phase = "chunk";
    setQueue((prev) =>
      prev.map((q) => (q.id === item.id ? { ...q, phase: "chunk" } : q))
    );

    for (let chunkIndex = 0; chunkIndex < totalChunks; chunkIndex++) {
      if (uploadedSet.has(chunkIndex)) {
        continue;
      }

      const start = chunkIndex * CHUNK_SIZE;
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunkBlob = file.slice(start, end);

      await fetchWithRetry(
        `/api/admin/gallery-upload/${galleryId}?action=chunk`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/octet-stream",
            "X-CSRF-Token": csrfToken,
            "X-Upload-Id": uploadId,
            "X-Chunk-Index": String(chunkIndex),
            "X-Total-Chunks": String(totalChunks),
          },
          body: chunkBlob,
        },
        "chunk"
      );

      uploadedSet.add(chunkIndex);
      const currentProgress = Math.round((uploadedSet.size / totalChunks) * 100);
      item.progress = currentProgress;

      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, progress: currentProgress } : q))
      );
    }

    if (uploadedSet.size !== totalChunks) {
      throw new Error(`Envoi incomplet : ${uploadedSet.size}/${totalChunks} morceaux transmis.`);
    }

    // Step 3: Finalize
    item.phase = "finalize";
    setQueue((prev) =>
      prev.map((q) => (q.id === item.id ? { ...q, phase: "finalize" } : q))
    );

    await fetchWithRetry(
      `/api/admin/gallery-upload/${galleryId}?action=finalize`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-CSRF-Token": csrfToken,
        },
        body: JSON.stringify({
          action: "finalize",
          uploadId,
        }),
      },
      "finalize"
    );

    item.status = "completed";
    item.progress = 100;
    item.error = undefined;
    setQueue((prev) =>
      prev.map((q) => (q.id === item.id ? { ...q, status: "completed", progress: 100, error: undefined } : q))
    );
  };

  // Robust queue processor with strict concurrency limit of exactly 2
  const processQueue = useCallback(async () => {
    if (isProcessingRef.current) return;

    const hasPending = queueRef.current.some((q) => q.status === "pending");
    if (!hasPending) return;

    isProcessingRef.current = true;
    setIsProcessing(true);

    const CONCURRENCY = 2;

    const pump = async (): Promise<void> => {
      while (true) {
        const item = queueRef.current.find((q) => q.status === "pending");
        if (!item) break;

        item.status = "uploading";

        try {
          await uploadSingleFile(item);
        } catch (err: unknown) {
          const errorMsg = err instanceof Error ? err.message : "Erreur lors du transfert";
          const phase = (err as unknown as { phase?: UploadPhase }).phase || item.phase || "chunk";
          item.status = "error";
          item.error = errorMsg;
          item.phase = phase;

          setQueue((prev) =>
            prev.map((q) =>
              q.id === item.id
                ? { ...q, status: "error", error: errorMsg, phase, uploadId: item.uploadId }
                : q
            )
          );
        }
      }
    };

    const runners: Promise<void>[] = [];
    const pendingCount = queueRef.current.filter((q) => q.status === "pending").length;
    const countToLaunch = Math.min(CONCURRENCY, pendingCount);

    for (let i = 0; i < countToLaunch; i++) {
      runners.push(pump());
    }

    await Promise.all(runners);

    isProcessingRef.current = false;
    setIsProcessing(false);
  }, [galleryId, csrfToken]);

  useEffect(() => {
    const hasPending = queue.some((q) => q.status === "pending");
    if (hasPending && !isProcessingRef.current) {
      void processQueue();
    }
  }, [queue, processQueue]);

  // When all items finish (no pending, no uploading, at least one completed), notify batch
  useEffect(() => {
    const anyPendingOrUploading = queue.some((q) => q.status === "pending" || q.status === "uploading");
    const hasCompleted = queue.some((q) => q.status === "completed");

    if (!isProcessing && !anyPendingOrUploading && hasCompleted && !hasNotifiedBatchRef.current) {
      hasNotifiedBatchRef.current = true;
      setBatchCompleted(true);
      onUploadBatchComplete(galleryFolderName);
    }
  }, [queue, isProcessing, galleryFolderName, onUploadBatchComplete]);

  const retryItem = (id: string) => {
    hasNotifiedBatchRef.current = false;
    setBatchCompleted(false);
    setQueue((prev) =>
      prev.map((q) => (q.id === id ? { ...q, status: "pending", error: undefined } : q))
    );
  };

  const retryAllFailed = () => {
    hasNotifiedBatchRef.current = false;
    setBatchCompleted(false);
    setQueue((prev) =>
      prev.map((q) => (q.status === "error" ? { ...q, status: "pending", error: undefined } : q))
    );
  };

  const cancelItem = async (id: string, uploadId?: string) => {
    if (uploadId) {
      try {
        await fetch(`/api/admin/gallery-upload/${galleryId}?action=cancel&uploadId=${uploadId}`, {
          method: "POST",
          headers: { "X-CSRF-Token": csrfToken },
        });
      } catch {
        // ignore cancel error
      }
    }
    setQueue((prev) => prev.filter((q) => q.id !== id));
  };

  const handlePhotosClick = () => {
    photoInputRef.current?.click();
  };

  const handleVideosClick = () => {
    videoInputRef.current?.click();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files, "photos");
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const totalFiles = queue.length;
  const completedFiles = queue.filter((q) => q.status === "completed").length;
  const errorItems = queue.filter((q) => q.status === "error").length;
  const currentUploading = queue.find((q) => q.status === "uploading");
  const overallProgress = totalFiles > 0 ? Math.round((completedFiles / totalFiles) * 100) : 0;

  const completedPhotos = queue.filter((q) => q.status === "completed" && q.target === "photos").length;
  const completedVideos = queue.filter((q) => q.status === "completed" && q.target === "videos").length;

  return (
    <div
      className={`${styles.uploadSection} ${isDragging ? styles.uploadSectionDragging : ""}`}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      aria-label="Zone d'importation de médias dans la galerie"
    >
      <div className={styles.uploadButtonsRow}>
        <input
          ref={photoInputRef}
          type="file"
          data-testid="photo-file-input"
          accept="image/jpeg,image/png,image/webp,image/avif"
          multiple
          className={styles.visuallyHidden}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFilesToQueue(e.target.files, "photos");
              e.target.value = "";
            }
          }}
        />

        <input
          ref={videoInputRef}
          type="file"
          data-testid="video-file-input"
          accept="video/mp4,video/webm"
          multiple
          className={styles.visuallyHidden}
          aria-hidden="true"
          tabIndex={-1}
          onChange={(e) => {
            if (e.target.files && e.target.files.length > 0) {
              addFilesToQueue(e.target.files, "videos");
              e.target.value = "";
            }
          }}
        />

        <button
          ref={photosButtonRef}
          type="button"
          onClick={handlePhotosClick}
          disabled={isProcessing}
          className={styles.uploadPhotosBtn}
          aria-label="Importer des photos"
        >
          📷 Importer des photos
        </button>

        <button
          ref={videosButtonRef}
          type="button"
          onClick={handleVideosClick}
          disabled={isProcessing}
          className={styles.uploadVideosBtn}
          aria-label="Importer des vidéos"
        >
          🎬 Importer des vidéos
        </button>

        {errorItems > 0 && !isProcessing && (
          <button
            type="button"
            onClick={retryAllFailed}
            className={styles.retryAllBtn}
            aria-label="Réessayer tous les échecs"
          >
            🔄 Réessayer tous les échecs ({errorItems})
          </button>
        )}
      </div>

      <p className={styles.helperText}>
        Glissez-déposez des photos ou des vidéos ici, ou utilisez les boutons ci-dessus.
        Taille maximale : 100 Mo par photo, 20 Go par vidéo. Transfert découpé en morceaux de 5 Mo avec reprise automatique.
      </p>

      {batchError && (
        <div role="alert" className={styles.errorMessage}>
          {batchError}
        </div>
      )}

      {/* Queue & Progress View */}
      {queue.length > 0 && (
        <div className={styles.uploadStatusContainer} aria-live="polite">
          <div className={styles.uploadSummaryRow}>
            <span>
              <strong>Lot en cours :</strong> {completedFiles} / {totalFiles} fichier(s) terminé(s)
              {errorItems > 0 && ` • ${errorItems} échec(s)`}
            </span>
            <progress
              className={styles.uploadProgressBar}
              value={overallProgress}
              max={100}
              aria-label={`Progression globale du lot : ${overallProgress}%`}
            >
              {overallProgress}%
            </progress>
          </div>

          {currentUploading && (
            <div role="status" aria-live="polite" className={styles.currentUploadingBox}>
              <p className={styles.currentUploadingText}>
                <strong>Envoi en cours ({formatPhase(currentUploading.phase)}) :</strong> {currentUploading.file.name}{" "}
                <span className={styles.targetBadge}>
                  {currentUploading.target === "photos" ? "Photo" : "Vidéo"}
                </span>{" "}
                ({currentUploading.progress}%)
              </p>
              <progress
                className={styles.uploadProgressBar}
                value={currentUploading.progress}
                max={100}
                aria-label={`Progression du fichier ${currentUploading.file.name} : ${currentUploading.progress}%`}
              >
                {currentUploading.progress}%
              </progress>
            </div>
          )}

          {batchCompleted && errorItems === 0 && (
            <p role="status" className={styles.successMessage}>
              ✓ Tous les fichiers ont été envoyés avec succès ({completedPhotos} photo(s), {completedVideos} vidéo(s)) dans le dossier de la galerie ({galleryFolderName}).
              L'analyse a été déclenchée ci-dessous.
            </p>
          )}

          <ul className={styles.uploadQueueList} aria-label="Liste des fichiers du lot">
            {queue.map((item) => (
              <li key={item.id} className={styles.uploadQueueItem}>
                <span className={styles.uploadItemName} title={item.file.name}>
                  {item.target === "photos" ? "📷" : "🎬"} {item.file.name} ({(item.file.size / 1024 / 1024).toFixed(1)} Mo)
                  <span className={styles.targetBadge}>
                    {item.target === "photos" ? "Photo" : "Vidéo"}
                  </span>
                </span>

                {item.status === "pending" && (
                  <span className={`${styles.uploadItemStatus} ${styles.uploadItemPending}`}>En attente</span>
                )}

                {item.status === "uploading" && (
                  <span className={`${styles.uploadItemStatus} ${styles.uploadItemUploading}`}>
                    {formatPhase(item.phase)} : {item.progress}%
                  </span>
                )}

                {item.status === "completed" && (
                  <span className={`${styles.uploadItemStatus} ${styles.uploadItemSuccess}`}>✓ Terminé</span>
                )}

                {item.status === "error" && (
                  <div role="alert" className={`${styles.uploadItemStatus} ${styles.uploadItemError}`}>
                    <span>Échec ({formatPhase(item.phase)}) : {item.error || "Erreur"}</span>
                    <button
                      type="button"
                      onClick={() => retryItem(item.id)}
                      className={styles.retryBtn}
                      aria-label={`Réessayer l'envoi de ${item.file.name}`}
                    >
                      Réessayer
                    </button>
                    <button
                      type="button"
                      onClick={() => void cancelItem(item.id, item.uploadId)}
                      className={styles.cancelBtn}
                      aria-label={`Annuler l'envoi de ${item.file.name}`}
                    >
                      Annuler
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

export default GalleryBrowserUpload;
