"use client";

// Full-page rich text editor for league pages, news, and banner
// content. Built on TipTap (ProseMirror-based) — same family of
// editor used by Notion, Confluence, Linear, etc.
//
// Output: HTML. We sanitize via the existing DOMPurify pipeline
// before storing, then render the cleaned HTML directly on public
// pages (no markdown round-trip).
//
// Toolbar groups:
//   - Inline: bold / italic / underline / strikethrough / code
//   - Headings: paragraph / H1 / H2 / H3
//   - Color: text color
//   - Lists: bullet / numbered / blockquote / divider
//   - Align: left / center / right
//   - Insert: link / image / clear formatting
//   - Undo / redo

import { useCallback } from "react";
import { useEditor, EditorContent, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import Image from "@tiptap/extension-image";
import TextAlign from "@tiptap/extension-text-align";
import { TextStyle } from "@tiptap/extension-text-style";
import { Color } from "@tiptap/extension-color";
import Underline from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import "./RichEditor.css";

interface Props {
  /** Initial HTML to load. Editor mutates internally on every keystroke. */
  initialHtml: string;
  /** Called when admin clicks "Save" — receives the current HTML. */
  onChange: (html: string) => void;
  /** Optional placeholder string when editor is empty. */
  placeholder?: string;
  /** Disable editing (e.g. while saving). */
  disabled?: boolean;
}

const PRESET_COLORS = [
  "#0f172a", // slate-900
  "#dc2626", // red
  "#ea580c", // orange
  "#ca8a04", // amber
  "#16a34a", // green
  "#0284c7", // sky
  "#1d4ed8", // blue
  "#7c3aed", // violet
];

export function RichEditor({
  initialHtml,
  onChange,
  placeholder,
  disabled,
}: Props) {
  const editor = useEditor({
    immediatelyRender: false,
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        // We don't need ProseMirror's link extension when using
        // @tiptap/extension-link — disable it here to avoid double-init.
      }),
      Underline,
      Link.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: {
          rel: "noopener noreferrer",
          target: "_blank",
        },
      }),
      Image.configure({
        inline: false,
        allowBase64: true,
      }),
      TextAlign.configure({ types: ["heading", "paragraph"] }),
      TextStyle,
      Color,
      Placeholder.configure({
        placeholder: placeholder ?? "Start writing…",
      }),
    ],
    content: initialHtml || "<p></p>",
    editable: !disabled,
    onUpdate: ({ editor: ed }) => {
      onChange(ed.getHTML());
    },
  });

  // Keep editor.editable in sync with `disabled` prop.
  if (editor && editor.isEditable === !!disabled) {
    editor.setEditable(!disabled);
  }

  const promptLink = useCallback(() => {
    if (!editor) return;
    const prev = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("URL (leave blank to remove)", prev ?? "");
    if (url === null) return;
    if (url === "") {
      editor.chain().focus().unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url }).run();
  }, [editor]);

  const promptImage = useCallback(() => {
    if (!editor) return;
    const url = window.prompt(
      "Image URL (paste a public link or a /path):",
      "",
    );
    if (!url) return;
    editor.chain().focus().setImage({ src: url }).run();
  }, [editor]);

  const uploadImage = useCallback(
    (file: File) => {
      if (!editor) return;
      if (file.size > 1_500_000) {
        alert(
          `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. ` +
            `Max 1.5 MB per image. iPhones save big — try Settings → Camera → ` +
            `Formats → "Most Compatible" before retaking, or shrink the image first.`,
        );
        return;
      }
      const reader = new FileReader();
      reader.onload = () => {
        if (typeof reader.result === "string") {
          editor.chain().focus().setImage({ src: reader.result }).run();
        }
      };
      reader.readAsDataURL(file);
    },
    [editor],
  );

  if (!editor) return null;

  return (
    <div className="rt-wrap">
      <Toolbar
        editor={editor}
        onLink={promptLink}
        onImageUrl={promptImage}
        onImageUpload={uploadImage}
      />
      <EditorContent editor={editor} className="rt-content" />
    </div>
  );
}

function Toolbar({
  editor,
  onLink,
  onImageUrl,
  onImageUpload,
}: {
  editor: Editor;
  onLink: () => void;
  onImageUrl: () => void;
  onImageUpload: (f: File) => void;
}) {
  const Btn = ({
    onClick,
    active,
    title,
    children,
    disabled,
  }: {
    onClick: () => void;
    active?: boolean;
    title: string;
    children: React.ReactNode;
    disabled?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      title={title}
      disabled={disabled}
      className={`rt-btn ${active ? "rt-btn-active" : ""}`}
    >
      {children}
    </button>
  );

  const Sep = () => <span className="rt-sep" aria-hidden />;

  return (
    <div className="rt-toolbar">
      <Btn
        title="Undo (⌘Z)"
        onClick={() => editor.chain().focus().undo().run()}
        disabled={!editor.can().chain().focus().undo().run()}
      >
        ↶
      </Btn>
      <Btn
        title="Redo (⌘⇧Z)"
        onClick={() => editor.chain().focus().redo().run()}
        disabled={!editor.can().chain().focus().redo().run()}
      >
        ↷
      </Btn>
      <Sep />

      <select
        className="rt-select"
        value={
          editor.isActive("heading", { level: 1 })
            ? "h1"
            : editor.isActive("heading", { level: 2 })
              ? "h2"
              : editor.isActive("heading", { level: 3 })
                ? "h3"
                : "p"
        }
        onChange={(e) => {
          const v = e.target.value;
          const c = editor.chain().focus();
          if (v === "p") c.setParagraph().run();
          else if (v === "h1") c.toggleHeading({ level: 1 }).run();
          else if (v === "h2") c.toggleHeading({ level: 2 }).run();
          else if (v === "h3") c.toggleHeading({ level: 3 }).run();
        }}
      >
        <option value="p">Body text</option>
        <option value="h1">Heading 1</option>
        <option value="h2">Heading 2</option>
        <option value="h3">Heading 3</option>
      </select>
      <Sep />

      <Btn
        title="Bold (⌘B)"
        onClick={() => editor.chain().focus().toggleBold().run()}
        active={editor.isActive("bold")}
      >
        <strong>B</strong>
      </Btn>
      <Btn
        title="Italic (⌘I)"
        onClick={() => editor.chain().focus().toggleItalic().run()}
        active={editor.isActive("italic")}
      >
        <em>I</em>
      </Btn>
      <Btn
        title="Underline (⌘U)"
        onClick={() => editor.chain().focus().toggleUnderline().run()}
        active={editor.isActive("underline")}
      >
        <span style={{ textDecoration: "underline" }}>U</span>
      </Btn>
      <Btn
        title="Strikethrough"
        onClick={() => editor.chain().focus().toggleStrike().run()}
        active={editor.isActive("strike")}
      >
        <span style={{ textDecoration: "line-through" }}>S</span>
      </Btn>
      <Btn
        title="Inline code"
        onClick={() => editor.chain().focus().toggleCode().run()}
        active={editor.isActive("code")}
      >
        <code>{"<>"}</code>
      </Btn>
      <Sep />

      {/* Color picker — current swatch + dropdown of presets */}
      <div className="rt-color">
        <input
          type="color"
          value={
            (editor.getAttributes("textStyle").color as string) ?? "#0f172a"
          }
          onChange={(e) => {
            editor.chain().focus().setColor(e.target.value).run();
          }}
          title="Pick text color"
          className="rt-color-input"
        />
        {PRESET_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className="rt-color-swatch"
            style={{ background: c }}
            title={`Set color to ${c}`}
            onClick={() => editor.chain().focus().setColor(c).run()}
          />
        ))}
        <Btn
          title="Clear color"
          onClick={() => editor.chain().focus().unsetColor().run()}
        >
          ⨯
        </Btn>
      </div>
      <Sep />

      <Btn
        title="Bulleted list"
        onClick={() => editor.chain().focus().toggleBulletList().run()}
        active={editor.isActive("bulletList")}
      >
        •
      </Btn>
      <Btn
        title="Numbered list"
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
        active={editor.isActive("orderedList")}
      >
        1.
      </Btn>
      <Btn
        title="Blockquote"
        onClick={() => editor.chain().focus().toggleBlockquote().run()}
        active={editor.isActive("blockquote")}
      >
        ❝
      </Btn>
      <Btn
        title="Divider"
        onClick={() => editor.chain().focus().setHorizontalRule().run()}
      >
        ─
      </Btn>
      <Sep />

      <Btn
        title="Align left"
        onClick={() => editor.chain().focus().setTextAlign("left").run()}
        active={editor.isActive({ textAlign: "left" })}
      >
        ⬅
      </Btn>
      <Btn
        title="Align center"
        onClick={() => editor.chain().focus().setTextAlign("center").run()}
        active={editor.isActive({ textAlign: "center" })}
      >
        ↔
      </Btn>
      <Btn
        title="Align right"
        onClick={() => editor.chain().focus().setTextAlign("right").run()}
        active={editor.isActive({ textAlign: "right" })}
      >
        ➡
      </Btn>
      <Sep />

      <Btn title="Insert link (⌘K)" onClick={onLink} active={editor.isActive("link")}>
        🔗
      </Btn>
      <Btn title="Insert image from a URL on the web" onClick={onImageUrl}>
        🖼 Image URL
      </Btn>
      {/* Photo upload — `image/*` triggers the iOS native picker
          ("Photo Library / Take Photo / Choose File"). Same on
          Android. Desktop = system file dialog. */}
      <label
        className="rt-btn rt-btn-upload"
        title="Upload a photo from your phone or computer"
      >
        📷 Upload photo
        <input
          type="file"
          accept="image/*"
          style={{ display: "none" }}
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) onImageUpload(f);
            // Reset so picking the same file twice still fires.
            e.currentTarget.value = "";
          }}
        />
      </label>
      <Sep />

      <Btn
        title="Clear formatting"
        onClick={() =>
          editor.chain().focus().unsetAllMarks().clearNodes().run()
        }
      >
        Tx
      </Btn>
    </div>
  );
}
