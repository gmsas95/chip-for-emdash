import { useState } from "react";
import type { ProductDocument, ProductImage, VariantDocument, InventoryDocument } from "../domain/products.js";
import { createEmptyProductDraft, serializeProductDraft, type InventoryEditorDraft, type ProductEditorDraft, type ProductSavePayload, type VariantEditorDraft } from "./product-form.js";
import { uploadProductImage } from "./media.js";
import { AdminPageShell, DataState, formatMinorAmount, requestCommerce, useCommerceData, useCommerceMutation, type AdminPageElement, type AdminPageProps } from "./shared.js";

interface ProductListResponse {
  items: Array<{ id: string; data: ProductDocument }>;
  hasMore: boolean;
  cursor?: string;
}

interface ProductAggregate {
  product: { id: string; data: ProductDocument };
  variants: Array<{ id: string; data: VariantDocument }>;
  inventory: Array<{ id: string; data: InventoryDocument }>;
}

function draftFromAggregate(aggregate: ProductAggregate): ProductEditorDraft {
  return {
    id: aggregate.product.id,
    name: aggregate.product.data.name,
    slug: aggregate.product.data.slug,
    description: aggregate.product.data.description,
    status: aggregate.product.data.status,
    sku: aggregate.product.data.sku ?? "",
    priceMinor: aggregate.product.data.priceMinor === undefined ? "" : (aggregate.product.data.priceMinor / 100).toFixed(2),
    compareAtMinor: aggregate.product.data.compareAtMinor === undefined ? "" : (aggregate.product.data.compareAtMinor / 100).toFixed(2),
    currency: aggregate.product.data.currency,
    hasVariants: aggregate.product.data.hasVariants,
    images: aggregate.product.data.images,
    variants: aggregate.variants.map(({ id, data }) => ({
      id,
      name: data.name,
      sku: data.sku,
      status: data.status,
      priceMinor: (data.priceMinor / 100).toFixed(2),
      currency: data.currency,
      optionsText: Object.entries(data.options).map(([key, value]) => `${key}=${value}`).join("\n"),
    })),
    inventory: aggregate.inventory.map(({ id, data }) => ({
      id,
      variantId: data.variantId,
      sku: data.sku,
      status: data.status,
      available: String(data.available),
      reserved: String(data.reserved),
    })),
  };
}

function emptyVariant(): VariantEditorDraft {
  return { name: "", sku: "", status: "draft", priceMinor: "", currency: "MYR", optionsText: "" };
}

function emptyInventory(variantId?: string): InventoryEditorDraft {
  return { variantId, sku: "", status: "active", available: "0", reserved: "0" };
}

function imageRow(image: ProductImage, index: number, onChange: (image: ProductImage) => void, onRemove: () => void): AdminPageElement {
  return (
    <fieldset key={`${image.mediaId}-${index}`}>
      <legend>Image {index + 1}</legend>
      <label>Media ID <input value={image.mediaId} onChange={(event) => onChange({ ...image, mediaId: event.target.value })} /></label>
      <label>URL <input type="url" value={image.url} onChange={(event) => onChange({ ...image, url: event.target.value })} /></label>
      <label>Alt text <input value={image.alt} onChange={(event) => onChange({ ...image, alt: event.target.value })} /></label>
      <button type="button" onClick={onRemove}>Remove image</button>
    </fieldset>
  );
}

export function ProductsPage({ apiBasePath }: AdminPageProps): AdminPageElement {
  const list = useCommerceData<ProductListResponse>("/products", apiBasePath);
  const save = useCommerceMutation<ProductSavePayload, ProductAggregate>("/products/save", apiBasePath);
  const archive = useCommerceMutation<{ productId: string }, { productId: string; status: string }>("/products/archive", apiBasePath);
  const [editor, setEditor] = useState<ProductEditorDraft>();
  const [editorLoading, setEditorLoading] = useState(false);
  const [editorError, setEditorError] = useState<string>();
  const [uploadingImage, setUploadingImage] = useState(false);

  async function openEdit(productId: string): Promise<void> {
    setEditorLoading(true);
    setEditorError(undefined);
    try {
      const aggregate = await requestCommerce<ProductAggregate>(`/products/detail?productId=${encodeURIComponent(productId)}`, "GET", undefined, apiBasePath);
      setEditor(draftFromAggregate(aggregate));
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : "Unable to load product");
    } finally {
      setEditorLoading(false);
    }
  }

  async function uploadImage(file: File): Promise<void> {
    if (!editor) return;
    setUploadingImage(true);
    setEditorError(undefined);
    try {
      const image = await uploadProductImage(file, file.name);
      setEditor({ ...editor, images: [...editor.images, image] });
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : "Unable to upload image");
    } finally {
      setUploadingImage(false);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault();
    if (!editor) return;
    setEditorError(undefined);
    try {
      await save.submit(serializeProductDraft(editor));
      setEditor(undefined);
      list.reload();
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : "Unable to save product");
    }
  }

  async function archiveProduct(productId: string): Promise<void> {
    if (!window.confirm("Archive this product? Existing orders and references will remain intact.")) return;
    try {
      await archive.submit({ productId });
      if (editor?.id === productId) setEditor(undefined);
      list.reload();
    } catch (reason) {
      setEditorError(reason instanceof Error ? reason.message : "Unable to archive product");
    }
  }

  return (
    <AdminPageShell title="Products">
      <div className="commerce-admin-toolbar">
        <button type="button" onClick={() => { setEditor(createEmptyProductDraft()); setEditorError(undefined); }}>New product</button>
      </div>
      <DataState {...list}>
        <table>
          <thead><tr><th scope="col">Product</th><th scope="col">SKU</th><th scope="col">Price</th><th scope="col">Status</th><th scope="col">Actions</th></tr></thead>
          <tbody>
            {list.data?.items.length === 0 ? <tr><td colSpan={5}>No products yet. Create your first product.</td></tr> : null}
            {list.data?.items.map(({ id, data }) => (
              <tr key={id}>
                <th scope="row">{data.name}</th>
                <td>{data.sku ?? "—"}</td>
                <td>{data.priceMinor === undefined ? "Variant pricing" : formatMinorAmount(data.priceMinor, data.currency)}</td>
                <td>{data.status}</td>
                <td><button type="button" onClick={() => void openEdit(id)}>Edit</button> <button type="button" onClick={() => void archiveProduct(id)}>Archive</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </DataState>
      {editorLoading ? <p role="status">Loading product...</p> : null}
      {editor ? (
        <form onSubmit={(event) => void submit(event)}>
          <h2>{editor.id ? "Edit product" : "New product"}</h2>
          {editorError || save.error || archive.error ? <p role="alert">{editorError ?? save.error ?? archive.error}</p> : null}
          <label>Name <input required value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} /></label>
          <label>Slug <input required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" value={editor.slug} onChange={(event) => setEditor({ ...editor, slug: event.target.value })} /></label>
          <label>Description <textarea value={editor.description} onChange={(event) => setEditor({ ...editor, description: event.target.value })} /></label>
          <label>Status <select value={editor.status} onChange={(event) => setEditor({ ...editor, status: event.target.value as ProductEditorDraft["status"] })}><option value="draft">Draft</option><option value="published">Published</option><option value="archived">Archived</option></select></label>
          <label>SKU <input value={editor.sku} onChange={(event) => setEditor({ ...editor, sku: event.target.value })} /></label>
          <label>Currency <input required maxLength={3} value={editor.currency} onChange={(event) => setEditor({ ...editor, currency: event.target.value.toUpperCase() })} /></label>
          <label>Price <input inputMode="decimal" placeholder="12.00" value={editor.priceMinor} onChange={(event) => setEditor({ ...editor, priceMinor: event.target.value })} /></label>
          <label>Compare-at price <input inputMode="decimal" placeholder="15.00" value={editor.compareAtMinor} onChange={(event) => setEditor({ ...editor, compareAtMinor: event.target.value })} /></label>
          <label><input type="checkbox" checked={editor.hasVariants} onChange={(event) => setEditor({ ...editor, hasVariants: event.target.checked })} /> This product has variants</label>
          <section>
            <h3>Images</h3>
            {editor.images.map((image, index) => imageRow(
              image,
              index,
              (next) => setEditor({ ...editor, images: editor.images.map((item, itemIndex) => itemIndex === index ? next : item) }),
              () => setEditor({ ...editor, images: editor.images.filter((_, itemIndex) => itemIndex !== index) }),
            ))}
            <label>Upload product image
              <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" disabled={uploadingImage} onChange={(event) => {
                const file = event.currentTarget.files?.[0];
                event.currentTarget.value = "";
                if (file) void uploadImage(file);
              }} />
            </label>
            {uploadingImage ? <p role="status">Uploading image to R2...</p> : null}
            <button type="button" onClick={() => setEditor({ ...editor, images: [...editor.images, { mediaId: "", url: "", alt: "" }] })}>Add image reference</button>
          </section>
          {editor.hasVariants ? (
            <section>
              <h3>Variants</h3>
              {editor.variants.map((variant, index) => (
                <fieldset key={variant.id ?? index}>
                  <legend>{variant.name || `Variant ${index + 1}`}</legend>
                  <label>Name <input required value={variant.name} onChange={(event) => setEditor({ ...editor, variants: editor.variants.map((item, itemIndex) => itemIndex === index ? { ...item, name: event.target.value } : item) })} /></label>
                  <label>SKU <input required value={variant.sku} onChange={(event) => setEditor({ ...editor, variants: editor.variants.map((item, itemIndex) => itemIndex === index ? { ...item, sku: event.target.value } : item) })} /></label>
                  <label>Price <input required inputMode="decimal" value={variant.priceMinor} onChange={(event) => setEditor({ ...editor, variants: editor.variants.map((item, itemIndex) => itemIndex === index ? { ...item, priceMinor: event.target.value } : item) })} /></label>
                  <label>Options <textarea placeholder={"size=Large\ncolor=Red"} value={variant.optionsText} onChange={(event) => setEditor({ ...editor, variants: editor.variants.map((item, itemIndex) => itemIndex === index ? { ...item, optionsText: event.target.value } : item) })} /></label>
                  <button type="button" onClick={() => setEditor({ ...editor, variants: editor.variants.filter((_, itemIndex) => itemIndex !== index), inventory: editor.inventory.filter((item) => item.variantId !== variant.id) })}>Remove variant</button>
                </fieldset>
              ))}
              <button type="button" onClick={() => setEditor({ ...editor, variants: [...editor.variants, emptyVariant()] })}>Add variant</button>
              <h3>Inventory</h3>
              {editor.inventory.map((item, index) => (
                <fieldset key={item.id ?? index}>
                  <legend>{item.sku || `Inventory ${index + 1}`}</legend>
                  <label>Variant <select value={item.variantId ?? ""} onChange={(event) => setEditor({ ...editor, inventory: editor.inventory.map((row, rowIndex) => rowIndex === index ? { ...row, variantId: event.target.value || undefined } : row) })}><option value="">Product SKU</option>{editor.variants.map((variant) => <option key={variant.id ?? variant.sku} value={variant.id ?? ""}>{variant.name || variant.sku}</option>)}</select></label>
                  <label>SKU <input required value={item.sku} onChange={(event) => setEditor({ ...editor, inventory: editor.inventory.map((row, rowIndex) => rowIndex === index ? { ...row, sku: event.target.value } : row) })} /></label>
                  <label>Available <input required inputMode="numeric" value={item.available} onChange={(event) => setEditor({ ...editor, inventory: editor.inventory.map((row, rowIndex) => rowIndex === index ? { ...row, available: event.target.value } : row) })} /></label>
                  <label>Reserved <input required inputMode="numeric" value={item.reserved} onChange={(event) => setEditor({ ...editor, inventory: editor.inventory.map((row, rowIndex) => rowIndex === index ? { ...row, reserved: event.target.value } : row) })} /></label>
                  <button type="button" onClick={() => setEditor({ ...editor, inventory: editor.inventory.filter((_, rowIndex) => rowIndex !== index) })}>Remove inventory row</button>
                </fieldset>
              ))}
              <button type="button" onClick={() => setEditor({ ...editor, inventory: [...editor.inventory, emptyInventory()] })}>Add inventory row</button>
            </section>
          ) : null}
          <button type="submit" disabled={save.loading}>{save.loading ? "Saving..." : "Save product"}</button>
          <button type="button" onClick={() => setEditor(undefined)}>Cancel</button>
        </form>
      ) : null}
    </AdminPageShell>
  );
}
