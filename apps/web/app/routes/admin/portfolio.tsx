import { useState, useRef, useCallback, useEffect } from "react";
import {
  type ActionFunctionArgs,
  type LoaderFunctionArgs,
  Form,
  Link,
  useActionData,
  useLoaderData,
  useNavigation,
} from "react-router";
import { requireValidAdminSession, createAdminHeaders } from "../../lib/admin-auth.server";
import { constantTimeEqual } from "../../lib/auth.server";
import { validateOrigin, readStrictFormUrlEncoded, ActionSecurityError } from "../../lib/security.server";
import {
  type PortfolioContent,
  type PortfolioProject,
  type PortfolioCategoryItem,
  resolveProjectPresentationMode,
} from "../../lib/portfolio-content.shared";
import {
  getRawPortfolioContent,
  savePortfolioContent,
  cleanupUnreferencedPortfolioMedia,
} from "../../lib/portfolio-content.server";
import { RevisionConflictError, ValidationError } from "../../lib/site-content.server";
import { ResponsivePortfolioImage } from "../../components/public/ResponsivePortfolioImage";
import styles from "./portfolio.module.css";

interface LoaderData {
  content: PortfolioContent;
  csrfToken: string;
}

export function meta() {
  return [
    { title: "Portfolio | Administration Parallax" },
    { name: "robots", content: "noindex, nofollow" },
  ];
}

export async function loader({ request }: LoaderFunctionArgs) {
  const session = await requireValidAdminSession(request);
  const csrfToken = session.get("csrfToken");

  const { content } = getRawPortfolioContent();
  return Response.json(
    { content, csrfToken },
    { headers: createAdminHeaders() }
  );
}

const ALLOWED_PORTFOLIO_ACTIONS = [
  "intent",
  "csrfToken",
  "revision",
  "projectId",
  "category",
  "direction",
  "categoryId",
  "targetCategoryId",
  "overview_title_fr",
  "overview_title_en",
  "overview_intro_fr",
  "overview_intro_en",
  "overview_seo_title_fr",
  "overview_seo_title_en",
  "overview_seo_desc_fr",
  "overview_seo_desc_en",
  "overview_seeMoreButton_fr",
  "overview_seeMoreButton_en",
] as const;

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== "POST") {
    return new Response("Method Not Allowed", {
      status: 405,
      headers: { Allow: "POST", ...createAdminHeaders() },
    });
  }

  const session = await requireValidAdminSession(request);

  if (!validateOrigin(request)) {
    return Response.json({ error: "Origine non autorisée." }, { status: 403, headers: createAdminHeaders() });
  }

  let formData: URLSearchParams;
  try {
    formData = await readStrictFormUrlEncoded(request, 64 * 1024, ALLOWED_PORTFOLIO_ACTIONS);
  } catch (err) {
    if (err instanceof ActionSecurityError) {
      const headers = createAdminHeaders();
      if (err.status === 405) headers.set("Allow", "POST");
      return Response.json({ error: err.message }, { status: err.status, headers });
    }
    return Response.json({ error: "Bad Request" }, { status: 400, headers: createAdminHeaders() });
  }

  const csrfToken = formData.get("csrfToken");
  const sessionCsrf = session.get("csrfToken");

  if (!csrfToken || !sessionCsrf || !constantTimeEqual(String(csrfToken), sessionCsrf)) {
    return Response.json({ error: "Jeton CSRF invalide ou expiré." }, { status: 403, headers: createAdminHeaders() });
  }

  const intent = formData.get("intent");
  const expectedRevision = String(formData.get("revision") || "");

  const { content } = getRawPortfolioContent();
  const nextContent = JSON.parse(JSON.stringify(content));

  try {
    // ---------------------------------------------------------
    // CATEGORY ACTIONS
    // ---------------------------------------------------------

    if (intent === "create_category") {
      const newCatId = crypto.randomUUID();
      const baseOrder = nextContent.categories.length;
      const uniqueSuffix = Date.now().toString(36);

      const newCategory: PortfolioCategoryItem = {
        id: newCatId,
        slugFr: `nouvelle-rubrique-${uniqueSuffix}`,
        slugEn: `new-category-${uniqueSuffix}`,
        order: baseOrder,
        status: "draft",
        title: {
          fr: "Nouvelle rubrique",
          en: "New category",
        },
        intro: {
          fr: "Présentation de la nouvelle rubrique.",
          en: "Introduction to the new category.",
        },
        entrySummary: {
          fr: "Présentation succincte pour la vue d'ensemble.",
          en: "Brief presentation for the portfolio overview.",
        },
        entrySide: "auto",
        seo: {
          title: {
            fr: "Nouvelle rubrique | Parallax",
            en: "New category | Parallax",
          },
          description: {
            fr: "Découvrez les réalisations de cette rubrique.",
            en: "Discover projects from this category.",
          },
        },
        coverImageId: null,
        coverAlt: { fr: "Couverture rubrique", en: "Category cover" },
        entryImageId: null,
        entryAlt: { fr: "Visuel d'entrée", en: "Entry visual" },
        bannerImageId: null,
        bannerAlt: { fr: "Bannière d'en-tête", en: "Header banner" },
        showreelTitle: { fr: "Showreel", en: "Showreel" },
        showreelVideo: null,
        showreelCoverImageId: null,
        morePhotosButton: { fr: "Voir plus de photos", en: "See more photos" },
        lessPhotosButton: { fr: "Voir moins", en: "See less" },
        backButton: { fr: "Retour aux projets", en: "Back to projects" },
      };

      nextContent.categories.push(newCategory);
      const saveResult = await savePortfolioContent(nextContent, expectedRevision);

      return Response.json(
        {
          success: "Nouvelle rubrique créée en brouillon avec succès.",
          createdCategoryId: newCatId,
          categoryId: newCatId,
          newRevision: saveResult.newRevision,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "toggle_category_status") {
      const categoryId = String(formData.get("categoryId") || "");
      const cat = nextContent.categories.find((c: PortfolioCategoryItem) => c.id === categoryId);
      if (!cat) {
        return Response.json({ error: "Rubrique introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      const nextStatus = cat.status === "published" ? "draft" : "published";
      if (nextStatus === "published") {
        if (!cat.title?.fr?.trim() || !cat.title?.en?.trim()) {
          return Response.json(
            { error: "Impossible de publier cette rubrique : le titre FR et EN est requis." },
            { status: 422, headers: createAdminHeaders() }
          );
        }
      }

      cat.status = nextStatus;
      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        {
          success: `Statut de la rubrique mis à jour (${nextStatus === "published" ? "Publiée" : "Masquée"}).`,
          newRevision: saveResult.newRevision,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "reorder_category") {
      const categoryId = String(formData.get("categoryId") || "");
      const direction = String(formData.get("direction") || "");

      nextContent.categories.sort((a: PortfolioCategoryItem, b: PortfolioCategoryItem) => a.order - b.order);
      const idx = nextContent.categories.findIndex((c: PortfolioCategoryItem) => c.id === categoryId);

      if (idx === -1) {
        return Response.json({ error: "Rubrique introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      if (direction === "up" && idx > 0) {
        const prev = nextContent.categories[idx - 1];
        const tmp = nextContent.categories[idx].order;
        nextContent.categories[idx].order = prev.order;
        prev.order = tmp;
      } else if (direction === "down" && idx < nextContent.categories.length - 1) {
        const next = nextContent.categories[idx + 1];
        const tmp = nextContent.categories[idx].order;
        nextContent.categories[idx].order = next.order;
        next.order = tmp;
      }

      nextContent.categories.sort((a: PortfolioCategoryItem, b: PortfolioCategoryItem) => a.order - b.order);
      nextContent.categories.forEach((c: PortfolioCategoryItem, i: number) => {
        c.order = i;
      });

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        { success: "Ordre des rubriques mis à jour.", newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "delete_category") {
      const categoryId = String(formData.get("categoryId") || "");
      const catIndex = nextContent.categories.findIndex((c: PortfolioCategoryItem) => c.id === categoryId);
      if (catIndex === -1) {
        return Response.json({ error: "Rubrique introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      const attachedProjects = nextContent.projects.filter((p: PortfolioProject) => p.category === categoryId);
      if (attachedProjects.length > 0) {
        return Response.json(
          {
            error: `Cette rubrique contient ${attachedProjects.length} projet(s). Impossible de la supprimer sans réaffecter ses projets vers une autre rubrique.`,
          },
          { status: 422, headers: createAdminHeaders() }
        );
      }

      nextContent.categories.splice(catIndex, 1);
      nextContent.categories.forEach((c: PortfolioCategoryItem, i: number) => {
        c.order = i;
      });

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      void cleanupUnreferencedPortfolioMedia().catch(() => undefined);

      return Response.json(
        {
          success: "Rubrique supprimée définitivement.",
          deletedCategoryId: categoryId,
          newRevision: saveResult.newRevision,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "delete_category_reassign") {
      const categoryId = String(formData.get("categoryId") || "");
      const targetCategoryId = String(formData.get("targetCategoryId") || "");

      const catIndex = nextContent.categories.findIndex((c: PortfolioCategoryItem) => c.id === categoryId);
      if (catIndex === -1) {
        return Response.json({ error: "Rubrique à supprimer introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      const targetCat = nextContent.categories.find((c: PortfolioCategoryItem) => c.id === targetCategoryId);
      if (!targetCat || targetCategoryId === categoryId) {
        return Response.json(
          { error: "Rubrique de destination invalide ou identique à la rubrique source." },
          { status: 400, headers: createAdminHeaders() }
        );
      }

      let reassignedCount = 0;
      for (const p of nextContent.projects) {
        if (p.category === categoryId) {
          p.category = targetCategoryId;
          reassignedCount++;
        }
      }

      nextContent.categories.splice(catIndex, 1);
      nextContent.categories.forEach((c: PortfolioCategoryItem, i: number) => {
        c.order = i;
      });

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      void cleanupUnreferencedPortfolioMedia().catch(() => undefined);

      return Response.json(
        {
          success: `Rubrique supprimée et ${reassignedCount} projet(s) déplacé(s) vers "${targetCat.title.fr}".`,
          deletedCategoryId: categoryId,
          newRevision: saveResult.newRevision,
        },
        { headers: createAdminHeaders() }
      );
    }

    // ---------------------------------------------------------
    // OVERVIEW ACTIONS
    // ---------------------------------------------------------

    if (intent === "save_overview") {
      nextContent.overview = {
        title: {
          fr: String(formData.get("overview_title_fr") || "").trim() || nextContent.overview.title.fr,
          en: String(formData.get("overview_title_en") || "").trim() || nextContent.overview.title.en,
        },
        intro: {
          fr: String(formData.get("overview_intro_fr") || "").trim() || nextContent.overview.intro.fr,
          en: String(formData.get("overview_intro_en") || "").trim() || nextContent.overview.intro.en,
        },
        seo: {
          title: {
            fr: String(formData.get("overview_seo_title_fr") || "").trim() || nextContent.overview.seo.title.fr,
            en: String(formData.get("overview_seo_title_en") || "").trim() || nextContent.overview.seo.title.en,
          },
          description: {
            fr: String(formData.get("overview_seo_desc_fr") || "").trim() || nextContent.overview.seo.description.fr,
            en: String(formData.get("overview_seo_desc_en") || "").trim() || nextContent.overview.seo.description.en,
          },
        },
        seeMoreButton: {
          fr: String(formData.get("overview_seeMoreButton_fr") || "").trim() || nextContent.overview.seeMoreButton.fr,
          en: String(formData.get("overview_seeMoreButton_en") || "").trim() || nextContent.overview.seeMoreButton.en,
        },
      };

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        { success: "Présentation générale du Portfolio enregistrée.", newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    // ---------------------------------------------------------
    // PROJECT ACTIONS
    // ---------------------------------------------------------

    if (intent === "create") {
      if (!Array.isArray(nextContent.categories) || nextContent.categories.length === 0) {
        return Response.json(
          { error: "Veuillez créer une rubrique avant d'ajouter un projet." },
          { status: 422, headers: createAdminHeaders() }
        );
      }

      const category = String(formData.get("category") || "").trim();
      if (!category) {
        return Response.json(
          { error: "Veuillez spécifier une rubrique pour ce projet." },
          { status: 422, headers: createAdminHeaders() }
        );
      }

      const catExists = nextContent.categories.some((c: PortfolioCategoryItem) => c.id === category);
      if (!catExists) {
        return Response.json(
          { error: "La rubrique sélectionnée est introuvable ou a été supprimée." },
          { status: 422, headers: createAdminHeaders() }
        );
      }

      const newId = crypto.randomUUID();
      const uniqueSuffix = Date.now().toString(36);
      const newOrder = nextContent.projects.filter((p: PortfolioProject) => p.category === category).length;

      const newProject: PortfolioProject = {
        id: newId,
        category,
        slugFr: `nouveau-projet-${uniqueSuffix}`,
        slugEn: `new-project-${uniqueSuffix}`,
        title: {
          fr: "Nouveau projet",
          en: "New project",
        },
        summary: {
          fr: "Résumé du projet en quelques lignes.",
          en: "Project summary in a few lines.",
        },
        description: [
          {
            type: "paragraph",
            text: {
              fr: "Description détaillée du projet.",
              en: "Detailed description of the project.",
            },
          },
        ],
        seo: {
          title: {
            fr: "Nouveau projet | Parallax",
            en: "New project | Parallax",
          },
          description: {
            fr: "Découvrez cette réalisation du studio Parallax.",
            en: "Discover this project by Parallax studio.",
          },
        },
        coverImageId: null,
        coverAlt: {
          fr: "Visuel du projet",
          en: "Project visual",
        },
        galleryImageIds: [],
        video: null,
        showcase: false,
        side: "auto",
        order: newOrder,
        status: "draft",
        archived: false,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      };

      nextContent.projects.push(newProject);
      const saveResult = await savePortfolioContent(nextContent, expectedRevision);

      return Response.json(
        { success: "Nouveau projet créé en brouillon avec succès.", createdId: newId, newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "toggle_status") {
      const projectId = String(formData.get("projectId") || "");
      const project = nextContent.projects.find((p: PortfolioProject) => p.id === projectId);
      if (!project) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      const newStatus = project.status === "published" ? "draft" : "published";

      if (newStatus === "published") {
        if (!project.coverImageId) {
          return Response.json(
            { error: "Impossible de publier ce projet : une image de couverture est requise." },
            { status: 422, headers: createAdminHeaders() }
          );
        }
      }

      project.status = newStatus;
      project.updatedAt = Date.now();

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        {
          success: `Statut du projet mis à jour (${project.status === "published" ? "Publié" : "Brouillon"}).`,
          newRevision: saveResult.newRevision,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "toggle_archive") {
      const projectId = String(formData.get("projectId") || "");
      const project = nextContent.projects.find((p: PortfolioProject) => p.id === projectId);
      if (!project) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      project.archived = !project.archived;
      project.updatedAt = Date.now();

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        { success: `Projet ${project.archived ? "archivé" : "restauré"}.`, newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "delete") {
      const projectId = String(formData.get("projectId") || "");
      const index = nextContent.projects.findIndex((p: PortfolioProject) => p.id === projectId);
      if (index === -1) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      nextContent.projects.splice(index, 1);
      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      void cleanupUnreferencedPortfolioMedia().catch(() => undefined);

      return Response.json(
        {
          success: "Projet supprimé définitivement.",
          deletedProjectId: projectId,
          newRevision: saveResult.newRevision,
        },
        { headers: createAdminHeaders() }
      );
    }

    if (intent === "reorder") {
      const projectId = String(formData.get("projectId") || "");
      const direction = String(formData.get("direction") || "");
      const project = nextContent.projects.find((p: PortfolioProject) => p.id === projectId);
      if (!project) {
        return Response.json({ error: "Projet introuvable." }, { status: 404, headers: createAdminHeaders() });
      }

      const sameCatProjects = nextContent.projects
        .filter((p: PortfolioProject) => p.category === project.category)
        .sort((a: PortfolioProject, b: PortfolioProject) => a.order - b.order);

      const currentIndex = sameCatProjects.findIndex((p: PortfolioProject) => p.id === projectId);
      if (direction === "up" && currentIndex > 0) {
        const prev = sameCatProjects[currentIndex - 1];
        const tempOrder = project.order;
        project.order = prev.order;
        prev.order = tempOrder;
      } else if (direction === "down" && currentIndex < sameCatProjects.length - 1) {
        const next = sameCatProjects[currentIndex + 1];
        const tempOrder = project.order;
        project.order = next.order;
        next.order = tempOrder;
      }

      const saveResult = await savePortfolioContent(nextContent, expectedRevision);
      return Response.json(
        { success: "Ordre mis à jour.", newRevision: saveResult.newRevision },
        { headers: createAdminHeaders() }
      );
    }

    return Response.json({ error: "Action inconnue." }, { status: 400, headers: createAdminHeaders() });
  } catch (err) {
    if (err instanceof RevisionConflictError) {
      return Response.json(
        {
          error: "Conflit de révision : la page a été modifiée par un autre utilisateur. Veuillez recharger la page.",
          currentRevision: content.revision,
        },
        { status: 409, headers: createAdminHeaders() }
      );
    }
    if (err instanceof ValidationError) {
      return Response.json({ error: err.message }, { status: 422, headers: createAdminHeaders() });
    }
    return Response.json(
      { error: "Une erreur inattendue est survenue." },
      { status: 500, headers: createAdminHeaders() }
    );
  }
}

function isElementFocusable(el: HTMLElement): boolean {
  if (el.hasAttribute("disabled")) return false;
  if (el.getAttribute("aria-hidden") === "true") return false;
  if (el.getAttribute("tabindex") === "-1") return false;
  if (el.hasAttribute("inert")) return false;
  if (el instanceof HTMLInputElement && el.type === "hidden") return false;
  if (el.style.display === "none" || el.style.visibility === "hidden") return false;
  return true;
}

function getModalFocusableElements(container: HTMLElement): HTMLElement[] {
  const candidates = Array.from(
    container.querySelectorAll<HTMLElement>(
      'button:not([disabled]), [href], input:not([type="hidden"]):not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"]):not([disabled])'
    )
  );
  return candidates.filter(isElementFocusable);
}

export default function AdminPortfolioPage() {
  const { content, csrfToken } = useLoaderData<LoaderData>();
  const actionData = useActionData<{
    error?: string;
    success?: string;
    createdId?: string;
    createdCategoryId?: string;
    deletedCategoryId?: string;
    deletedProjectId?: string;
  }>();
  const navigation = useNavigation();
  const isSubmitting = navigation.state === "submitting";

  const [categoryFilter, setCategoryFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "published" | "draft" | "archived">("all");
  const [projectToDelete, setProjectToDelete] = useState<PortfolioProject | null>(null);
  const [categoryToDelete, setCategoryToDelete] = useState<PortfolioCategoryItem | null>(null);
  const [targetReassignCategory, setTargetReassignCategory] = useState<string>("");
  const [isOverviewOpen, setIsOverviewOpen] = useState(false);

  const categoryModalRef = useRef<HTMLDivElement | null>(null);
  const projectModalRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const addCategoryBtnRef = useRef<HTMLButtonElement | null>(null);
  const addProjectBtnRef = useRef<HTMLButtonElement | null>(null);
  const mainContentRef = useRef<HTMLDivElement | null>(null);
  const lastClosedModalRef = useRef<"category" | "project" | null>(null);
  const modalOpenRef = useRef<boolean>(false);

  const categories = Array.isArray(content.categories) ? content.categories : [];
  const sortedCategories = [...categories].sort((a, b) => a.order - b.order);

  const isModalOpen = Boolean(categoryToDelete || projectToDelete);

  // Reset category filter if the active filtered category is removed
  useEffect(() => {
    if (categoryFilter !== "all" && !categories.some((c) => c.id === categoryFilter)) {
      setCategoryFilter("all");
    }
  }, [categoryFilter, categories]);

  // Modal helpers
  const closeCategoryModal = useCallback(() => {
    if (isSubmitting) return;
    lastClosedModalRef.current = "category";
    setCategoryToDelete(null);
    setTargetReassignCategory("");
  }, [isSubmitting]);

  const closeProjectModal = useCallback(() => {
    if (isSubmitting) return;
    lastClosedModalRef.current = "project";
    setProjectToDelete(null);
  }, [isSubmitting]);

  // Restore focus AFTER modal closes and background is no longer inert
  useEffect(() => {
    if (modalOpenRef.current && !isModalOpen) {
      const target = previousActiveElementRef.current;
      if (target && target.isConnected && document.body.contains(target)) {
        target.focus();
      } else if (lastClosedModalRef.current === "category" && addCategoryBtnRef.current) {
        addCategoryBtnRef.current.focus();
      } else if (lastClosedModalRef.current === "project" && addProjectBtnRef.current) {
        addProjectBtnRef.current.focus();
      }
      lastClosedModalRef.current = null;
    }
    modalOpenRef.current = isModalOpen;
  }, [isModalOpen]);

  // Close modal on mutation success, preserve on error
  useEffect(() => {
    if (actionData?.success) {
      if (actionData.deletedCategoryId && categoryToDelete?.id === actionData.deletedCategoryId) {
        lastClosedModalRef.current = "category";
        setCategoryToDelete(null);
        setTargetReassignCategory("");
      }
      if (actionData.deletedProjectId && projectToDelete?.id === actionData.deletedProjectId) {
        lastClosedModalRef.current = "project";
        setProjectToDelete(null);
      }
    }
  }, [actionData, categoryToDelete, projectToDelete]);

  // Focus trap & Escape key listener for open modals
  useEffect(() => {
    if (!categoryToDelete && !projectToDelete) return;

    const modalEl = categoryToDelete ? categoryModalRef.current : projectModalRef.current;
    let timer: ReturnType<typeof setTimeout> | null = null;

    if (modalEl) {
      timer = setTimeout(() => {
        const focusable = getModalFocusableElements(modalEl);
        // Prioritize interactive form inputs (e.g. destination select) or cancel button
        const preferred =
          modalEl.querySelector<HTMLElement>("select:not([disabled])") ||
          modalEl.querySelector<HTMLElement>("button[type='button']:not([disabled])") ||
          (focusable.length > 0 ? focusable[0] : null);

        if (preferred && isElementFocusable(preferred)) {
          preferred.focus();
        } else if (focusable.length > 0) {
          focusable[0].focus();
        } else {
          modalEl.focus();
        }
      }, 50);
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        if (categoryToDelete) {
          closeCategoryModal();
        } else if (projectToDelete) {
          closeProjectModal();
        }
        return;
      }

      if (e.key === "Tab") {
        const currentModal = categoryToDelete ? categoryModalRef.current : projectModalRef.current;
        if (!currentModal) return;
        const focusable = getModalFocusableElements(currentModal);
        if (focusable.length === 0) {
          e.preventDefault();
          currentModal.focus();
          return;
        }
        const first = focusable[0];
        const last = focusable[focusable.length - 1];

        // Bring focus inside if event originated outside
        if (!currentModal.contains(document.activeElement)) {
          e.preventDefault();
          if (e.shiftKey) {
            last.focus();
          } else {
            first.focus();
          }
          return;
        }

        if (e.shiftKey && (document.activeElement === first || document.activeElement === currentModal)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [categoryToDelete, projectToDelete, closeCategoryModal, closeProjectModal]);

  const filteredProjects = content.projects
    .filter((p) => {
      if (categoryFilter !== "all" && p.category !== categoryFilter) return false;
      if (statusFilter === "published" && (p.status !== "published" || p.archived)) return false;
      if (statusFilter === "draft" && (p.status !== "draft" || p.archived)) return false;
      if (statusFilter === "archived" && !p.archived) return false;
      return true;
    })
    .sort((a, b) => a.order - b.order);

  const projectsInDeletingCategory = categoryToDelete
    ? content.projects.filter((p) => p.category === categoryToDelete.id)
    : [];

  const otherCategories = categoryToDelete
    ? categories.filter((c) => c.id !== categoryToDelete.id)
    : [];

  return (
    <>
      <div
        ref={mainContentRef}
        className={styles.container}
        inert={isModalOpen ? true : undefined}
      >
        <Link to="/admin/dashboard" className={styles.backLink}>
        ← Retour au Dashboard
      </Link>

      <div className={styles.header}>
        <div>
          <h1 className={styles.title}>Gestion du Portfolio</h1>
          <p className={styles.headerSubtitle}>
            Administrez vos rubriques, réalisations, médias et mise en page du portfolio.
          </p>
        </div>

        <div className={styles.headerActions}>
          <button
            type="button"
            className={styles.secondaryBtn}
            onClick={() => setIsOverviewOpen(!isOverviewOpen)}
          >
            {isOverviewOpen ? "Fermer la présentation" : "Éditer la présentation générale"}
          </button>
        </div>
      </div>

      {actionData?.success && (
        <div className={styles.alertSuccess} role="status">
          {actionData.success}
          {actionData.createdId && (
            <Link
              to={`/admin/portfolio/${actionData.createdId}`}
              className={styles.sectionEditActive}
            >
              Ouvrir le projet →
            </Link>
          )}
          {actionData.createdCategoryId && (
            <Link
              to={`/admin/portfolio/section/${actionData.createdCategoryId}`}
              className={styles.sectionEditActive}
            >
              Éditer la rubrique →
            </Link>
          )}
        </div>
      )}

      {actionData?.error && (
        <div className={styles.alertError} role="alert">
          {actionData.error}
        </div>
      )}

      {/* Overview Edition Block */}
      {isOverviewOpen && (
        <div className={styles.blockCard}>
          <div className={styles.blockHeader}>
            <div>
              <h2 className={styles.blockTitle}>Présentation générale du Portfolio</h2>
              <p className={styles.blockSubtitle}>
                Textes d'accueil, SEO et bouton de découverte affichés sur la vitrine publique (/projets).
              </p>
            </div>
          </div>

          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="revision" value={content.revision} />
            <input type="hidden" name="intent" value="save_overview" />

            <div className={styles.overviewFormGrid}>
              <div className={styles.formCol}>
                <h3 className={styles.sectionCardTitle}>Contenu Français</h3>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_title_fr">Titre principal</label>
                  <input
                    id="overview_title_fr"
                    name="overview_title_fr"
                    defaultValue={content.overview.title.fr}
                    className={styles.inputField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_intro_fr">Texte d'introduction</label>
                  <textarea
                    id="overview_intro_fr"
                    name="overview_intro_fr"
                    defaultValue={content.overview.intro.fr}
                    className={styles.textareaField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_seo_title_fr">Titre SEO (FR)</label>
                  <input
                    id="overview_seo_title_fr"
                    name="overview_seo_title_fr"
                    defaultValue={content.overview.seo.title.fr}
                    className={styles.inputField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_seo_desc_fr">Description SEO (FR)</label>
                  <textarea
                    id="overview_seo_desc_fr"
                    name="overview_seo_desc_fr"
                    defaultValue={content.overview.seo.description.fr}
                    className={styles.textareaField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_seeMoreButton_fr">Bouton de découverte</label>
                  <input
                    id="overview_seeMoreButton_fr"
                    name="overview_seeMoreButton_fr"
                    defaultValue={content.overview.seeMoreButton.fr}
                    className={styles.inputField}
                    required
                  />
                </div>
              </div>

              <div className={styles.formCol}>
                <h3 className={styles.sectionCardTitle}>English Content</h3>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_title_en">Main Title</label>
                  <input
                    id="overview_title_en"
                    name="overview_title_en"
                    defaultValue={content.overview.title.en}
                    className={styles.inputField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_intro_en">Intro text</label>
                  <textarea
                    id="overview_intro_en"
                    name="overview_intro_en"
                    defaultValue={content.overview.intro.en}
                    className={styles.textareaField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_seo_title_en">SEO Title (EN)</label>
                  <input
                    id="overview_seo_title_en"
                    name="overview_seo_title_en"
                    defaultValue={content.overview.seo.title.en}
                    className={styles.inputField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_seo_desc_en">SEO Description (EN)</label>
                  <textarea
                    id="overview_seo_desc_en"
                    name="overview_seo_desc_en"
                    defaultValue={content.overview.seo.description.en}
                    className={styles.textareaField}
                    required
                  />
                </div>
                <div className={styles.fieldGroup}>
                  <label className={styles.fieldLabel} htmlFor="overview_seeMoreButton_en">Discovery Button</label>
                  <input
                    id="overview_seeMoreButton_en"
                    name="overview_seeMoreButton_en"
                    defaultValue={content.overview.seeMoreButton.en}
                    className={styles.inputField}
                    required
                  />
                </div>
              </div>
            </div>

            <div className={styles.overviewSaveBtnRow}>
              <button type="submit" disabled={isSubmitting} className={styles.primaryBtn}>
                Enregistrer la présentation
              </button>
            </div>
          </Form>
        </div>
      )}

      {/* --------------------------------------------------------- */}
      {/* RUBRIQUES MANAGEMENT BLOCK */}
      {/* --------------------------------------------------------- */}
      <div className={styles.blockCard}>
        <div className={styles.blockHeader}>
          <div>
            <h2 className={styles.blockTitle}>Rubriques du Portfolio</h2>
            <p className={styles.blockSubtitle}>
              Gérez vos catégories : création, ordre d'affichage, bannières, showreel et rattachement des projets.
            </p>
          </div>

          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="revision" value={content.revision} />
            <input type="hidden" name="intent" value="create_category" />
            <button
              ref={addCategoryBtnRef}
              type="submit"
              disabled={isSubmitting}
              className={styles.primaryBtn}
            >
              + Ajouter une rubrique
            </button>
          </Form>
        </div>

        {sortedCategories.length === 0 ? (
          <div className={styles.emptyTable}>
            <p className={styles.emptyTableText}>
              Le portfolio ne contient aucune rubrique actuellement.
            </p>
            <Form method="post">
              <input type="hidden" name="csrfToken" value={csrfToken} />
              <input type="hidden" name="revision" value={content.revision} />
              <input type="hidden" name="intent" value="create_category" />
              <button type="submit" disabled={isSubmitting} className={styles.primaryBtn}>
                Créer ma première rubrique
              </button>
            </Form>
          </div>
        ) : (
          <table className={styles.categoryListTable}>
            <thead>
              <tr className={styles.tableHeaderRow}>
                <th className={styles.tableTh}>Ordre</th>
                <th className={styles.tableTh}>Rubrique</th>
                <th className={styles.tableTh}>Slugs publics</th>
                <th className={styles.tableTh}>État</th>
                <th className={styles.tableTh}>Projets rattachés</th>
                <th className={styles.tableThRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {sortedCategories.map((cat, idx) => {
                const projectCount = content.projects.filter((p) => p.category === cat.id).length;
                return (
                  <tr key={cat.id} className={styles.categoryRow}>
                    <td className={styles.categoryCell}>
                      <div className={styles.orderButtons}>
                        <Form method="post" className={styles.inlineForm}>
                          <input type="hidden" name="csrfToken" value={csrfToken} />
                          <input type="hidden" name="revision" value={content.revision} />
                          <input type="hidden" name="intent" value="reorder_category" />
                          <input type="hidden" name="categoryId" value={cat.id} />
                          <input type="hidden" name="direction" value="up" />
                          <button
                            type="submit"
                            disabled={isSubmitting || idx === 0}
                            className={styles.orderBtn}
                            aria-label={`Monter la rubrique ${cat.title.fr}`}
                          >
                            ▲
                          </button>
                        </Form>
                        <Form method="post" className={styles.inlineForm}>
                          <input type="hidden" name="csrfToken" value={csrfToken} />
                          <input type="hidden" name="revision" value={content.revision} />
                          <input type="hidden" name="intent" value="reorder_category" />
                          <input type="hidden" name="categoryId" value={cat.id} />
                          <input type="hidden" name="direction" value="down" />
                          <button
                            type="submit"
                            disabled={isSubmitting || idx === sortedCategories.length - 1}
                            className={styles.orderBtn}
                            aria-label={`Descendre la rubrique ${cat.title.fr}`}
                          >
                            ▼
                          </button>
                        </Form>
                      </div>
                    </td>

                    <td className={styles.categoryCell}>
                      <div className={styles.categoryName}>{cat.title.fr}</div>
                      <div className={styles.categoryNameEn}>{cat.title.en}</div>
                    </td>

                    <td className={styles.categoryCell}>
                      <div>
                        <span className={styles.categorySlugBadge}>/fr/.../{cat.slugFr}</span>
                      </div>
                      <div>
                        <span className={styles.categorySlugBadge}>/en/.../{cat.slugEn}</span>
                      </div>
                    </td>

                    <td className={styles.categoryCell}>
                      {cat.status === "published" ? (
                        <span className={styles.badgePublished}>Publiée</span>
                      ) : (
                        <span className={styles.badgeDraft}>Masquée (Brouillon)</span>
                      )}
                    </td>

                    <td className={styles.categoryCell}>
                      <span className={styles.categoryProjectsCount}>
                        {projectCount} {projectCount > 1 ? "projets" : "projet"}
                      </span>
                    </td>

                    <td className={styles.categoryCell}>
                      <div className={styles.rowActions}>
                        <Link
                          to={`/admin/portfolio/section/${cat.id}`}
                          className={styles.secondaryBtn}
                        >
                          Éditer →
                        </Link>

                        <Form method="post" className={styles.inlineForm}>
                          <input type="hidden" name="csrfToken" value={csrfToken} />
                          <input type="hidden" name="revision" value={content.revision} />
                          <input type="hidden" name="intent" value="toggle_category_status" />
                          <input type="hidden" name="categoryId" value={cat.id} />
                          <button
                            type="submit"
                            disabled={isSubmitting}
                            className={styles.actionBtn}
                          >
                            {cat.status === "published" ? "Masquer" : "Publier"}
                          </button>
                        </Form>

                        <button
                          type="button"
                          className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                          onClick={(e) => {
                            previousActiveElementRef.current = e.currentTarget;
                            lastClosedModalRef.current = "category";
                            setCategoryToDelete(cat);
                            const others = categories.filter((c) => c.id !== cat.id);
                            if (others.length > 0) {
                              setTargetReassignCategory(others[0].id);
                            }
                          }}
                        >
                          Supprimer
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* --------------------------------------------------------- */}
      {/* PROJECTS MANAGEMENT SECTION */}
      {/* --------------------------------------------------------- */}
      <div className={styles.header}>
        <div>
          <h2 className={styles.blockTitle}>Projets & Réalisations</h2>
          <p className={styles.headerSubtitle}>
            Administrez vos projets photo et vidéo, leurs médias et leur ordre d'apparition.
          </p>
        </div>

        <div className={styles.headerActions}>
          <Form method="post">
            <input type="hidden" name="csrfToken" value={csrfToken} />
            <input type="hidden" name="revision" value={content.revision} />
            <input type="hidden" name="intent" value="create" />
            <input
              type="hidden"
              name="category"
              value={categoryFilter !== "all" ? categoryFilter : sortedCategories[0]?.id || ""}
            />
            <button
              ref={addProjectBtnRef}
              type="submit"
              disabled={isSubmitting || sortedCategories.length === 0}
              className={styles.primaryBtn}
            >
              + Nouveau projet
            </button>
          </Form>
        </div>
      </div>

      {/* Filter controls */}
      <div className={styles.filtersBar}>
        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Rubrique :</span>
          <button
            type="button"
            className={`${styles.filterBtn} ${categoryFilter === "all" ? styles.filterBtnActive : ""}`}
            onClick={() => setCategoryFilter("all")}
          >
            Toutes ({content.projects.length})
          </button>
          {sortedCategories.map((c) => {
            const count = content.projects.filter((p) => p.category === c.id).length;
            return (
              <button
                key={c.id}
                type="button"
                className={`${styles.filterBtn} ${categoryFilter === c.id ? styles.filterBtnActive : ""}`}
                onClick={() => setCategoryFilter(c.id)}
              >
                {c.title.fr} ({count})
              </button>
            );
          })}
        </div>

        <div className={styles.filterGroup}>
          <span className={styles.filterLabel}>Statut :</span>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "all" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("all")}
          >
            Tous
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "published" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("published")}
          >
            Publiés
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "draft" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("draft")}
          >
            Brouillons
          </button>
          <button
            type="button"
            className={`${styles.filterBtn} ${statusFilter === "archived" ? styles.filterBtnActive : ""}`}
            onClick={() => setStatusFilter("archived")}
          >
            Archivés
          </button>
        </div>
      </div>

      {/* Projects Table */}
      {filteredProjects.length === 0 ? (
        <div className={styles.emptyTable}>
          Aucun projet ne correspond aux filtres sélectionnés.
        </div>
      ) : (
        <div className={styles.tableResponsiveWrapper}>
          <table className={styles.projectsTable}>
            <thead>
              <tr className={styles.tableHeaderRow}>
                <th className={styles.tableTh}>Visuel</th>
                <th className={styles.tableTh}>Projet</th>
                <th className={styles.tableTh}>Rubrique</th>
                <th className={styles.tableTh}>Statut</th>
                <th className={styles.tableTh}>Mode</th>
                <th className={styles.tableTh}>Ordre</th>
                <th className={styles.tableThRight}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {filteredProjects.map((p, pIdx) => {
                const catItem = categories.find((c) => c.id === p.category);
                const catTitle = catItem ? catItem.title.fr : p.category;
                const isVideo = resolveProjectPresentationMode(p) === "video";
                const candidateCoverId = isVideo
                  ? p.video?.coverImageId || p.draftVideoCoverImageId || p.coverImageId
                  : p.coverImageId;
                const mediaItem = candidateCoverId ? content.media[candidateCoverId] : null;
                const effectiveOwnerId = mediaItem?.ownerId || p.id;
                const effectiveOwnerType = mediaItem?.ownerType || "project";
                const effectiveSlot = mediaItem?.mediaSlot || (isVideo && !p.coverImageId ? "video_cover" : "cover");

                return (
                  <tr key={p.id} className={styles.tableRow}>
                    <td className={`${styles.tableCell} ${styles.tableCellThumbnail}`}>
                      <div className={styles.projectThumb}>
                        {candidateCoverId ? (
                          <ResponsivePortfolioImage
                            imageId={candidateCoverId}
                            ownerType={effectiveOwnerType}
                            ownerId={effectiveOwnerId}
                            mediaSlot={effectiveSlot}
                            mediaMetadata={mediaItem}
                            alt={p.coverAlt?.fr || p.title?.fr || "Couverture projet"}
                            loading="lazy"
                            isAdminPreview={true}
                          />
                        ) : (
                          <div className={styles.projectThumbPlaceholder} aria-hidden="true">
                            {isVideo ? "Vidéo" : "Photo"}
                          </div>
                        )}
                      </div>
                    </td>

                  <td className={styles.tableCell}>
                    <div className={styles.projectTitleCell}>{p.title.fr}</div>
                    <div className={styles.projectTitleEn}>{p.title.en}</div>
                    <div className={styles.projectSlugHint}>
                      /fr/.../{p.slugFr} • /en/.../{p.slugEn}
                    </div>
                  </td>

                  <td className={styles.tableCell}>
                    <span className={styles.projectCategoryCell}>{catTitle}</span>
                  </td>

                  <td className={styles.tableCell}>
                    {p.archived ? (
                      <span className={styles.badgeArchived}>Archivé</span>
                    ) : p.status === "published" ? (
                      <span className={styles.badgePublished}>Publié</span>
                    ) : (
                      <span className={styles.badgeDraft}>Brouillon</span>
                    )}
                  </td>

                  <td className={styles.tableCell}>
                    <span className={styles.projectCategoryCell}>
                      {p.presentationMode === "video" || p.video?.url ? "Vidéo" : "Photo"}
                    </span>
                  </td>

                  <td className={styles.tableCell}>
                    <div className={styles.orderButtons}>
                      <Form method="post" className={styles.inlineForm}>
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="revision" value={content.revision} />
                        <input type="hidden" name="intent" value="reorder" />
                        <input type="hidden" name="projectId" value={p.id} />
                        <input type="hidden" name="direction" value="up" />
                        <button
                          type="submit"
                          disabled={isSubmitting || pIdx === 0}
                          className={styles.orderBtn}
                          aria-label={`Monter le projet ${p.title.fr}`}
                        >
                          ▲
                        </button>
                      </Form>
                      <Form method="post" className={styles.inlineForm}>
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="revision" value={content.revision} />
                        <input type="hidden" name="intent" value="reorder" />
                        <input type="hidden" name="projectId" value={p.id} />
                        <input type="hidden" name="direction" value="down" />
                        <button
                          type="submit"
                          disabled={isSubmitting || pIdx === filteredProjects.length - 1}
                          className={styles.orderBtn}
                          aria-label={`Descendre le projet ${p.title.fr}`}
                        >
                          ▼
                        </button>
                      </Form>
                    </div>
                  </td>

                  <td className={styles.tableCell}>
                    <div className={styles.rowActions}>
                      <Link to={`/admin/portfolio/${p.id}`} className={styles.secondaryBtn}>
                        Éditer →
                      </Link>

                      <Form method="post" className={styles.inlineForm}>
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="revision" value={content.revision} />
                        <input type="hidden" name="intent" value="toggle_status" />
                        <input type="hidden" name="projectId" value={p.id} />
                        <button
                          type="submit"
                          disabled={isSubmitting || p.archived}
                          className={styles.actionBtn}
                        >
                          {p.status === "published" ? "Dépublier" : "Publier"}
                        </button>
                      </Form>

                      <Form method="post" className={styles.inlineForm}>
                        <input type="hidden" name="csrfToken" value={csrfToken} />
                        <input type="hidden" name="revision" value={content.revision} />
                        <input type="hidden" name="intent" value="toggle_archive" />
                        <input type="hidden" name="projectId" value={p.id} />
                        <button type="submit" disabled={isSubmitting} className={styles.actionBtn}>
                          {p.archived ? "Désarchiver" : "Archiver"}
                        </button>
                      </Form>

                      <button
                        type="button"
                        className={`${styles.actionBtn} ${styles.actionBtnDanger}`}
                        onClick={(e) => {
                          previousActiveElementRef.current = e.currentTarget;
                          lastClosedModalRef.current = "project";
                          setProjectToDelete(p);
                        }}
                      >
                        Supprimer
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    )}
      </div>

      {/* Delete Project Modal */}
      {projectToDelete && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) closeProjectModal();
          }}
        >
          <div
            className={styles.modalDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="project-delete-title"
            ref={projectModalRef}
            tabIndex={-1}
          >
            <h3 id="project-delete-title" className={styles.modalTitle}>Confirmer la suppression</h3>
            <p className={styles.modalDesc}>
              Êtes-vous certain de vouloir supprimer définitivement le projet « {projectToDelete.title.fr} » ?
              Cette action est irréversible.
            </p>
            {actionData?.error && (
              <div className={styles.modalWarning} role="alert">
                {actionData.error}
              </div>
            )}
            <div className={styles.modalActions}>
              <button
                type="button"
                className={styles.secondaryBtn}
                onClick={closeProjectModal}
                disabled={isSubmitting}
              >
                Annuler
              </button>
              <Form method="post" className={styles.inlineForm}>
                <input type="hidden" name="csrfToken" value={csrfToken} />
                <input type="hidden" name="revision" value={content.revision} />
                <input type="hidden" name="intent" value="delete" />
                <input type="hidden" name="projectId" value={projectToDelete.id} />
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className={`${styles.primaryBtn} ${styles.dangerConfirmBtn}`}
                >
                  Supprimer définitivement
                </button>
              </Form>
            </div>
          </div>
        </div>
      )}

      {/* Delete Category Modal with Reassignment Control */}
      {categoryToDelete && (
        <div
          className={styles.modalOverlay}
          onClick={(e) => {
            if (e.target === e.currentTarget && !isSubmitting) closeCategoryModal();
          }}
        >
          <div
            className={styles.modalDialog}
            role="dialog"
            aria-modal="true"
            aria-labelledby="category-delete-title"
            ref={categoryModalRef}
            tabIndex={-1}
          >
            <h3 id="category-delete-title" className={styles.modalTitle}>Suppression de rubrique</h3>
            <p className={styles.modalDesc}>
              Vous êtes sur le point de supprimer la rubrique « {categoryToDelete.title.fr} ».
            </p>

            {actionData?.error && (
              <div className={styles.modalWarning} role="alert">
                {actionData.error}
              </div>
            )}

            {projectsInDeletingCategory.length > 0 ? (
              otherCategories.length === 0 ? (
                <div>
                  <div className={styles.modalWarning}>
                    <strong>Action bloquée :</strong> cette rubrique contient{" "}
                    <strong>{projectsInDeletingCategory.length} projet(s)</strong> (publiés, brouillons ou archivés).
                    Aucune autre rubrique n'existe pour les accueillir.
                  </div>
                  <p className={styles.modalDesc}>
                    Veuillez d'abord créer une autre rubrique de destination ou supprimer manuellement ces projets
                    avant de supprimer cette rubrique.
                  </p>
                  <div className={styles.modalActions}>
                    <button
                      type="button"
                      className={styles.secondaryBtn}
                      onClick={closeCategoryModal}
                    >
                      Fermer
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className={styles.modalWarning}>
                    Cette rubrique contient <strong>{projectsInDeletingCategory.length} projet(s)</strong>.
                    Pour éviter toute perte de contenu, ils doivent être réaffectés vers une autre rubrique existante.
                  </div>

                  <Form method="post">
                    <input type="hidden" name="csrfToken" value={csrfToken} />
                    <input type="hidden" name="revision" value={content.revision} />
                    <input type="hidden" name="intent" value="delete_category_reassign" />
                    <input type="hidden" name="categoryId" value={categoryToDelete.id} />

                    <div className={`${styles.fieldGroup} ${styles.reassignFieldGroup}`}>
                      <label className={styles.fieldLabel} htmlFor="targetCategoryId">
                        Déplacer les {projectsInDeletingCategory.length} projet(s) vers :
                      </label>
                      <select
                        id="targetCategoryId"
                        name="targetCategoryId"
                        value={targetReassignCategory}
                        onChange={(e) => setTargetReassignCategory(e.target.value)}
                        className={styles.selectField}
                        required
                      >
                        {otherCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.title.fr} ({c.title.en})
                          </option>
                        ))}
                      </select>
                    </div>

                    <div className={styles.modalActions}>
                      <button
                        type="button"
                        className={styles.secondaryBtn}
                        onClick={closeCategoryModal}
                        disabled={isSubmitting}
                      >
                        Annuler
                      </button>
                      <button
                        type="submit"
                        disabled={isSubmitting}
                        className={`${styles.primaryBtn} ${styles.dangerConfirmBtn}`}
                      >
                        Déplacer les projets et supprimer
                      </button>
                    </div>
                  </Form>
                </div>
              )
            ) : (
              <div>
                <p className={styles.modalDesc}>
                  Cette rubrique ne contient aucun projet. La confirmation supprimera définitivement cette rubrique.
                </p>
                <div className={styles.modalActions}>
                  <button
                    type="button"
                    className={styles.secondaryBtn}
                    onClick={closeCategoryModal}
                    disabled={isSubmitting}
                  >
                    Annuler
                  </button>
                  <Form method="post" className={styles.inlineForm}>
                    <input type="hidden" name="csrfToken" value={csrfToken} />
                    <input type="hidden" name="revision" value={content.revision} />
                    <input type="hidden" name="intent" value="delete_category" />
                    <input type="hidden" name="categoryId" value={categoryToDelete.id} />
                    <button
                      type="submit"
                      disabled={isSubmitting}
                      className={`${styles.primaryBtn} ${styles.dangerConfirmBtn}`}
                    >
                      Supprimer la rubrique
                    </button>
                  </Form>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
