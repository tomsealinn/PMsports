import { readFile } from "node:fs/promises";
import path from "node:path";

const HTML_FILES = new Map<string, string>([
  ["/next/sports.html", "sports.html"],
]);

export const runtime = "nodejs";

export async function GET(request: Request) {
  const { pathname } = new URL(request.url);
  const fileName = HTML_FILES.get(pathname);

  if (!fileName) {
    return new Response("Not found", { status: 404 });
  }

  const filePath = path.join(process.cwd(), "src", "app", "next", fileName);
  const body = await readFile(filePath, "utf8");

  return new Response(body, {
    headers: {
      "cache-control": "no-cache, must-revalidate",
      "content-type": "text/html; charset=utf-8",
    },
  });
}
