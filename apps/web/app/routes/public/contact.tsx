import { useEffect, useRef } from "react";
import type { ActionFunctionArgs, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation, Link } from "react-router";
import { Header } from "../../components/public/Header";
import { Footer } from "../../components/public/Footer";
import { ScrollToTop } from "../../components/public/ScrollToTop";
import {
  handleContactLoader,
  handleContactAction,
  type ContactActionResult,
  type ContactLoaderData,
} from "../../lib/contact.server";
import styles from "./contact.module.css";

export async function loader(args: LoaderFunctionArgs) {
  return handleContactLoader(args);
}

export async function action(args: ActionFunctionArgs) {
  return handleContactAction(args);
}

export function meta({ data }: { data?: ContactLoaderData }) {
  if (!data) {
    return [{ title: "Contact | Parallax" }];
  }
  const { content, lang } = data;
  return [
    { title: content.contactPage.seo.title[lang] },
    { name: "description", content: content.contactPage.seo.description[lang] },
  ];
}

export default function ContactPage() {
  const { lang, content, token, prefillType, flashSuccess, smtpAvailable } =
    useLoaderData<ContactLoaderData>();
  const actionData = useActionData<ContactActionResult>();
  const navigation = useNavigation();
  const errorSummaryRef = useRef<HTMLDivElement>(null);

  const contactPage = content.contactPage;
  const formContent = contactPage.form;
  const cardContent = contactPage.card;
  const messages = contactPage.messages;
  const homeContact = content.home.contact;

  const isSubmitting = navigation.state === "submitting" || navigation.state === "loading";
  const hasErrors = actionData && !actionData.ok;
  const fieldErrors = hasErrors ? actionData.fieldErrors : undefined;
  const values = hasErrors ? actionData.values : undefined;

  // Selected project type fallback
  const selectedType = values?.type !== undefined ? values.type : prefillType;

  // Focus error summary on rejected submission
  useEffect(() => {
    if (hasErrors && errorSummaryRef.current) {
      errorSummaryRef.current.focus();
    }
  }, [hasErrors]);

  const publicEmail = homeContact.email.trim();
  const publicPhone = cardContent.phone.trim();
  const instagramUrl = homeContact.instagramUrl.trim();
  const youtubeUrl = homeContact.youtubeUrl.trim();
  const responseTimeNotice = cardContent.responseTimeNotice[lang]?.trim();
  const privacyUrl = formContent.privacyPolicyUrl.trim();

  return (
    <div className={styles.container}>
      <Header common={content.common} lang={lang} currentRoute="contact" />

      {/* Hero Section */}
      <section className={styles.heroSection}>
        <h1 className={styles.heroTitle}>{contactPage.hero.title[lang]}</h1>
      </section>

      {/* Main Form & Details Section */}
      <section className={styles.mainSection}>
        <div className={styles.contentGrid}>
          {/* Left Column: Form */}
          <div className={styles.formColumn}>
            {/* Flash Success Banner (PRG) */}
            {flashSuccess && (
              <div role="status" aria-live="polite" className={styles.successBanner}>
                <h2 className={styles.successTitle}>{messages.successTitle[lang]}</h2>
                <p className={styles.successMessage}>{messages.successMessage[lang]}</p>
              </div>
            )}

            {/* Service Unavailable Banner */}
            {!smtpAvailable && !flashSuccess && (
              <div role="status" className={styles.unavailableBanner}>
                {messages.unavailableMessage[lang]}
              </div>
            )}

            {/* Error Summary Banner */}
            {hasErrors && actionData.error && (
              <div
                ref={errorSummaryRef}
                tabIndex={-1}
                role="alert"
                aria-live="assertive"
                className={styles.errorSummaryBanner}
              >
                {actionData.error}
              </div>
            )}

            <Form method="post" noValidate={false}>
              {/* Signed Anti-Spam Token */}
              <input type="hidden" name="_token" value={token} />

              {/* Honeypot field (hidden off-screen, skipped from tab order) */}
              <div className={styles.honeypot} aria-hidden="true">
                <label htmlFor="c-website">Website</label>
                <input
                  id="c-website"
                  type="text"
                  name="website"
                  tabIndex={-1}
                  autoComplete="off"
                  defaultValue=""
                />
              </div>

              {/* Name / Company Field */}
              <div className={styles.formGroup}>
                <label htmlFor="c-nom" className={styles.label}>
                  {formContent.nameLabel[lang]}
                </label>
                <input
                  id="c-nom"
                  name="name"
                  type="text"
                  required={true}
                  maxLength={100}
                  autoComplete="name"
                  placeholder={formContent.namePlaceholder[lang]}
                  defaultValue={values?.name ?? ""}
                  className={`${styles.input} ${fieldErrors?.name ? styles.inputError : ""}`}
                  aria-invalid={fieldErrors?.name ? "true" : undefined}
                  aria-describedby={fieldErrors?.name ? "c-nom-error" : undefined}
                />
                {fieldErrors?.name && (
                  <div id="c-nom-error" role="alert" className={styles.fieldError}>
                    {fieldErrors.name}
                  </div>
                )}
              </div>

              {/* Email & Phone Row */}
              <div className={styles.formGroupRow}>
                <div className={styles.formGroup}>
                  <label htmlFor="c-mail" className={styles.label}>
                    {formContent.emailLabel[lang]}
                  </label>
                  <input
                    id="c-mail"
                    name="email"
                    type="email"
                    required={true}
                    maxLength={254}
                    autoComplete="email"
                    placeholder={formContent.emailPlaceholder[lang]}
                    defaultValue={values?.email ?? ""}
                    className={`${styles.input} ${fieldErrors?.email ? styles.inputError : ""}`}
                    aria-invalid={fieldErrors?.email ? "true" : undefined}
                    aria-describedby={fieldErrors?.email ? "c-mail-error" : undefined}
                  />
                  {fieldErrors?.email && (
                    <div id="c-mail-error" role="alert" className={styles.fieldError}>
                      {fieldErrors.email}
                    </div>
                  )}
                </div>

                <div className={styles.formGroup}>
                  <label htmlFor="c-tel" className={styles.label}>
                    {formContent.phoneLabel[lang]}
                  </label>
                  <input
                    id="c-tel"
                    name="phone"
                    type="tel"
                    maxLength={50}
                    autoComplete="tel"
                    placeholder={formContent.phonePlaceholder[lang]}
                    defaultValue={values?.phone ?? ""}
                    className={`${styles.input} ${fieldErrors?.phone ? styles.inputError : ""}`}
                    aria-invalid={fieldErrors?.phone ? "true" : undefined}
                    aria-describedby={fieldErrors?.phone ? "c-tel-error" : undefined}
                  />
                  {fieldErrors?.phone && (
                    <div id="c-tel-error" role="alert" className={styles.fieldError}>
                      {fieldErrors.phone}
                    </div>
                  )}
                </div>
              </div>

              {/* Preferred Timeline Field */}
              <div className={styles.formGroup}>
                <label htmlFor="c-date" className={styles.label}>
                  {formContent.timelineLabel[lang]}
                </label>
                <input
                  id="c-date"
                  name="timeline"
                  type="text"
                  maxLength={120}
                  placeholder={formContent.timelinePlaceholder[lang]}
                  defaultValue={values?.timeline ?? ""}
                  className={`${styles.input} ${fieldErrors?.timeline ? styles.inputError : ""}`}
                  aria-invalid={fieldErrors?.timeline ? "true" : undefined}
                  aria-describedby={fieldErrors?.timeline ? "c-date-error" : undefined}
                />
                {fieldErrors?.timeline && (
                  <div id="c-date-error" role="alert" className={styles.fieldError}>
                    {fieldErrors.timeline}
                  </div>
                )}
              </div>

              {/* Project Type Select */}
              <div className={styles.formGroup}>
                <label htmlFor="c-type" className={styles.label}>
                  {formContent.typeLabel[lang]}
                </label>
                <select
                  id="c-type"
                  name="type"
                  required={true}
                  defaultValue={selectedType}
                  className={`${styles.select} ${fieldErrors?.type ? styles.selectError : ""}`}
                  aria-invalid={fieldErrors?.type ? "true" : undefined}
                  aria-describedby={fieldErrors?.type ? "c-type-error" : undefined}
                >
                  <option value="" disabled={true}>
                    {formContent.typePlaceholder[lang]}
                  </option>
                  {formContent.projectTypes
                    .filter((pt) => pt.enabled)
                    .map((pt) => (
                      <option key={pt.id} value={pt.id}>
                        {pt.label[lang]}
                      </option>
                    ))}
                </select>
                {fieldErrors?.type && (
                  <div id="c-type-error" role="alert" className={styles.fieldError}>
                    {fieldErrors.type}
                  </div>
                )}
              </div>

              {/* Message Textarea */}
              <div className={styles.formGroup}>
                <label htmlFor="c-msg" className={styles.label}>
                  {formContent.messageLabel[lang]}
                </label>
                <textarea
                  id="c-msg"
                  name="message"
                  required={true}
                  rows={6}
                  maxLength={5000}
                  placeholder={formContent.messagePlaceholder[lang]}
                  defaultValue={values?.message ?? ""}
                  className={`${styles.textarea} ${fieldErrors?.message ? styles.textareaError : ""}`}
                  aria-invalid={fieldErrors?.message ? "true" : undefined}
                  aria-describedby={fieldErrors?.message ? "c-msg-error" : undefined}
                />
                {fieldErrors?.message && (
                  <div id="c-msg-error" role="alert" className={styles.fieldError}>
                    {fieldErrors.message}
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                disabled={isSubmitting}
                className={styles.submitButton}
              >
                {isSubmitting
                  ? lang === "fr"
                    ? "Envoi en cours…"
                    : "Sending…"
                  : formContent.submitButton[lang]}
              </button>

              {/* Notice & Privacy Policy */}
              <p className={styles.noticeText}>
                {formContent.noticeText[lang]}
                {privacyUrl ? (
                  <>
                    <br />
                    <Link to={privacyUrl} className={styles.privacyLink}>
                      {formContent.privacyPolicyText[lang]}
                    </Link>
                  </>
                ) : (
                  <>
                    <br />
                    <span>{formContent.privacyPolicyText[lang]}</span>
                  </>
                )}
              </p>
            </Form>
          </div>

          {/* Right Column: Coordonnées Card */}
          <aside className={styles.card} aria-label={cardContent.title[lang]}>
            <h2 className={styles.cardTitle}>{cardContent.title[lang]}</h2>

            {/* Email */}
            {publicEmail && (
              <div className={styles.cardItem}>
                <div className={styles.cardLabel}>{cardContent.emailLabel[lang]}</div>
                <a href={`mailto:${publicEmail}`} className={styles.cardEmailLink}>
                  {publicEmail}
                </a>
              </div>
            )}

            {/* Phone */}
            {publicPhone && (
              <div className={styles.cardItem}>
                <div className={styles.cardLabel}>{cardContent.phoneLabel[lang]}</div>
                <a href={`tel:${publicPhone.replace(/\s+/g, "")}`} className={styles.cardPhoneLink}>
                  {publicPhone}
                </a>
              </div>
            )}

            {/* Socials */}
            {(instagramUrl || youtubeUrl) && (
              <div className={styles.cardItem}>
                <div className={styles.cardLabel}>{cardContent.socialLabel[lang]}</div>
                <div className={styles.cardSocialLinks}>
                  {instagramUrl && (
                    <a
                      href={instagramUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.socialLink}
                    >
                      Instagram
                    </a>
                  )}
                  {instagramUrl && youtubeUrl && <span className={styles.socialDivider}> · </span>}
                  {youtubeUrl && (
                    <a
                      href={youtubeUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.socialLink}
                    >
                      YouTube
                    </a>
                  )}
                </div>
              </div>
            )}

            {/* Response Time Notice */}
            {responseTimeNotice && (
              <div className={styles.cardFooter}>
                <p className={styles.responseTimeNotice}>{responseTimeNotice}</p>
              </div>
            )}
          </aside>
        </div>
      </section>

      {/* Footer */}
      <Footer common={content.common} lang={lang} theme="dark" />

      {/* Back to top button */}
      <ScrollToTop />
    </div>
  );
}
