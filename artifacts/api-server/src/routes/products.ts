import { Router, Request } from "express";
import { db } from "@workspace/db";
import { productsTable } from "@workspace/db";
import { eq, and } from "drizzle-orm";
import { CreateProductBody, UpdateProductParams, UpdateProductBody, DeleteProductParams } from "@workspace/api-zod";
import multer from "multer";
import { v2 as cloudinary } from "cloudinary";
import { Readable } from "stream";

cloudinary.config({
  cloud_name: process.env["CLOUDINARY_CLOUD_NAME"],
  api_key: process.env["CLOUDINARY_API_KEY"],
  api_secret: process.env["CLOUDINARY_API_SECRET"],
  secure: true,
});

const ALLOWED_MIME_TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif"]);

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter(_req, file, cb) {
    if (ALLOWED_MIME_TYPES.has(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Type de fichier non autorisé. Seuls JPEG, PNG, WEBP et GIF sont acceptés."));
    }
  },
});

function uploadToCloudinary(buffer: Buffer, folder = "wa-agent/products"): Promise<string> {
  return new Promise((resolve, reject) => {
    const stream = cloudinary.uploader.upload_stream(
      { folder, resource_type: "image" },
      (error, result) => {
        if (error || !result) return reject(error ?? new Error("Upload échoué"));
        resolve(result.secure_url);
      },
    );
    Readable.from(buffer).pipe(stream);
  });
}

type Sess = { userId?: number };
const uid = (req: Request): number => (req.session as Sess).userId!;

const router = Router();

router.post("/upload-image", upload.single("image"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Aucun fichier reçu" });
  try {
    const url = await uploadToCloudinary(req.file.buffer);
    return res.json({ url });
  } catch {
    return res.status(500).json({ error: "Erreur lors de l'upload vers Cloudinary" });
  }
});

router.get("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const products = await db.select().from(productsTable)
    .where(eq(productsTable.userId, userId))
    .orderBy(productsTable.createdAt);
  return res.json(products.map(p => ({
    ...p,
    price: Number(p.price),
    createdAt: p.createdAt.toISOString(),
    imageUrl: p.imageUrl ?? null,
    link: p.link ?? null,
    itemType: p.itemType ?? "product",
  })));
});

router.post("/", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const parsed = CreateProductBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const d = parsed.data as typeof parsed.data & { imageUrl?: string; link?: string; itemType?: string };
  const [product] = await db.insert(productsTable).values({
    userId,
    name: parsed.data.name,
    description: parsed.data.description,
    category: parsed.data.category,
    price: String(parsed.data.price),
    status: parsed.data.status ?? "active",
    imageUrl: d.imageUrl ?? null,
    link: d.link ?? null,
    itemType: d.itemType ?? "product",
  }).returning();
  return res.status(201).json({
    ...product,
    price: Number(product.price),
    createdAt: product.createdAt.toISOString(),
    imageUrl: product.imageUrl ?? null,
    link: product.link ?? null,
    itemType: product.itemType ?? "product",
  });
});

router.patch("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = UpdateProductParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  const parsed = UpdateProductBody.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.message });
  const data = parsed.data as {
    name?: string; description?: string; category?: string; price?: number;
    status?: string; imageUrl?: string; link?: string; itemType?: string;
  };
  const [product] = await db.update(productsTable).set({
    ...(data.name !== undefined && { name: data.name }),
    ...(data.description !== undefined && { description: data.description }),
    ...(data.category !== undefined && { category: data.category }),
    ...(data.price !== undefined && { price: String(data.price) }),
    ...(data.status !== undefined && { status: data.status }),
    ...(data.imageUrl !== undefined && { imageUrl: data.imageUrl || null }),
    ...(data.link !== undefined && { link: data.link || null }),
    ...(data.itemType !== undefined && { itemType: data.itemType }),
  }).where(and(eq(productsTable.id, params.data.id), eq(productsTable.userId, userId))).returning();
  if (!product) return res.status(404).json({ error: "Not found" });
  return res.json({
    ...product,
    price: Number(product.price),
    createdAt: product.createdAt.toISOString(),
    imageUrl: product.imageUrl ?? null,
    link: product.link ?? null,
    itemType: product.itemType ?? "product",
  });
});

router.delete("/:id", async (req, res) => {
  const userId = uid(req);
  if (!userId) return res.status(401).json({ error: "Non authentifié" });
  const params = DeleteProductParams.safeParse({ id: Number(req.params.id) });
  if (!params.success) return res.status(400).json({ error: "Invalid id" });
  await db.delete(productsTable).where(and(eq(productsTable.id, params.data.id), eq(productsTable.userId, userId)));
  return res.status(204).send();
});

export default router;
