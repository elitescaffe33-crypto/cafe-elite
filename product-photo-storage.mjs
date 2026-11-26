import sharp from "sharp";
import { StorageClient } from "@supabase/storage-js";
import { createHash } from "node:crypto";
import { OrderError } from "./order-catalogue.mjs";
import { isUploadedProductPhoto } from "./public-asset-allowlist.mjs";

export const PHOTO_BUCKET = "cafe-elite-product-photos";
export const MAX_PHOTO_INPUT = 5 * 1024 * 1024;
export const MAX_PHOTO_OUTPUT = 350 * 1024;
export const MAX_PHOTOS = 1000;
sharp.cache({ memory: 16, files: 0, items: 20 });
sharp.concurrency(1);
const inputTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
const fileName = path => path.slice("/product-photos/".length);
const photoPath = name => "/product-photos/" + name;

export function readPhotoBody(request) {
  const type = String(request.headers["content-type"] || "").split(";")[0].trim().toLowerCase();
  if (!inputTypes.has(type)) { request.resume(); throw new OrderError("Choose a JPEG, PNG or WebP photograph.", 415); }
  if (Number(request.headers["content-length"]) > MAX_PHOTO_INPUT) { request.resume(); throw new OrderError("Photo is too large. Maximum 5 MB.", 413); }
  return new Promise((resolve, reject) => {
    let size = 0, tooLarge = false;
    const chunks = [];
    request.on("data", chunk => {
      if (tooLarge) return;
      size += chunk.length;
      if (size > MAX_PHOTO_INPUT) {
        tooLarge = true; chunks.length = 0;
        reject(new OrderError("Photo is too large. Maximum 5 MB.", 413));
      } else chunks.push(chunk);
    });
    request.on("end", () => { if (!tooLarge) resolve(Buffer.concat(chunks)); });
    request.on("aborted", () => reject(new OrderError("Photo upload interrupted.", 400)));
    request.on("error", reject);
  });
}

export async function optimiseProductPhoto(bytes) {
  if (!Buffer.isBuffer(bytes) || !bytes.length || bytes.length > MAX_PHOTO_INPUT)
    throw new OrderError("Invalid photo or photo exceeds 5 MB.", 413);
  try {
    // Decode, validate dimensions, rotate from EXIF, remove metadata and re-encode.
    // Never trust an extension, browser MIME type, or user-supplied file name.
    const opts = { limitInputPixels: 24_000_000, failOn: "error", pages: 1, sequentialRead: true };
    const meta = await sharp(bytes, opts).metadata();
    if (!["jpeg", "png", "webp"].includes(meta.format) || !meta.width || !meta.height || meta.width * meta.height > 24_000_000 || (meta.pages || 1) !== 1)
      throw new Error("Invalid image");
    for (const [size, quality] of [[1400, 84], [1400, 72], [1200, 65], [950, 60]]) {
      const result = await sharp(bytes, opts).autoOrient().resize({ width: size, height: size, fit: "inside", withoutEnlargement: true }).flatten({ background: "#ffffff" }).webp({ quality, effort: 3 }).toBuffer();
      if (result.length <= MAX_PHOTO_OUTPUT) return result;
    }
  } catch { throw new OrderError("This image could not be opened. Choose a normal JPEG, PNG or WebP photograph.", 422); }
  throw new OrderError("This photo could not be compressed sufficiently.", 422);
}

export function referencedUploadedPhotos(settings) {
  const paths = [
    ...(Array.isArray(settings?.menuCustom?.customItems) ? settings.menuCustom.customItems.map(item => item?.image) : []),
    ...Object.values(settings?.menuOverrides || {}).map(item => item?.image),
  ];
  return new Set(paths.filter(isUploadedProductPhoto));
}

export function createProductPhotoStorage({ url, secret, client, fetchImpl = fetch } = {}) {
  const origin = new URL(url).origin;
  const headers = { apikey: secret, ...(secret.startsWith("sb_secret_") ? {} : { Authorization: "Bearer " + secret }) };
  const storage = client || new StorageClient(origin + "/storage/v1", headers,
    (input, init) => fetchImpl(input, { ...init, redirect: "error", signal: AbortSignal.timeout(12000) }));
  const bucket = storage.from(PHOTO_BUCKET);
  let ready;
  const publicUrl = path => {
    if (!isUploadedProductPhoto(path)) throw new OrderError("Invalid photo path.", 422);
    return origin + "/storage/v1/object/public/" + PHOTO_BUCKET + "/" + fileName(path);
  };
  async function ensureBucket() {
    if (!ready) ready = (async () => {
      const { data: buckets, error } = await storage.listBuckets();
      if (error || !Array.isArray(buckets)) throw new Error("Photo storage unavailable");
      let found = buckets.find(b => b.id === PHOTO_BUCKET);
      if (!found) {
        const result = await storage.createBucket(PHOTO_BUCKET, { public: true, fileSizeLimit: MAX_PHOTO_OUTPUT, allowedMimeTypes: ["image/webp"] });
        if (result.error) throw new Error("Photo bucket creation failed");
        const verified = await storage.getBucket(PHOTO_BUCKET);
        if (verified.error) throw new Error("Photo bucket verification failed");
        found = verified.data;
      }
      if (found?.public !== true || Number(found.file_size_limit) !== MAX_PHOTO_OUTPUT || !Array.isArray(found.allowed_mime_types) || found.allowed_mime_types.length !== 1 || found.allowed_mime_types[0] !== "image/webp")
        throw new Error("Photo bucket restrictions do not match");
    })().catch(error => { ready = undefined; throw error; });
    return ready;
  }
  async function list() {
    await ensureBucket();
    const { data, error } = await bucket.list("", { limit: MAX_PHOTOS, offset: 0, sortBy: { column: "created_at", order: "desc" } });
    if (error || !Array.isArray(data)) throw new Error("Photo library unavailable");
    return data.map(item => photoPath(item.name)).filter(isUploadedProductPhoto);
  }
  async function exists(path) {
    if (!isUploadedProductPhoto(path)) return false;
    await ensureBucket();
    const { data, error } = await bucket.exists(fileName(path));
    if (data === false) return false; // SDK returns a not-found error alongside false.
    if (error || data !== true) throw new Error("Photo storage unavailable");
    return true;
  }
  async function upload(bytes) {
    const output = await optimiseProductPhoto(bytes);
    const name = createHash("sha256").update(output).digest("hex") + ".webp";
    const path = photoPath(name);
    if (await exists(path)) return path;
    if ((await list()).length >= MAX_PHOTOS) throw new OrderError("Photo library is full. Ask the site administrator to review old photos.", 409);
    const result = await bucket.upload(name, output, { contentType: "image/webp", cacheControl: "31536000", upsert: false });
    if (result.error && !await exists(path)) throw new Error("Photo upload failed");
    if (!await exists(path)) throw new Error("Photo upload could not be verified");
    return path;
  }
  async function validateNewReferences(next, previous) {
    const old = referencedUploadedPhotos(previous);
    const fresh = [...referencedUploadedPhotos(next)].filter(path => !old.has(path));
    if (fresh.length > 20) throw new OrderError("Save at most 20 newly uploaded photos at once.", 422);
    for (const path of fresh) if (!await exists(path)) throw new OrderError("A selected uploaded photo was not found. Upload it again.", 422);
  }
  return { ensureBucket, list, upload, publicUrl, validateNewReferences };
}
