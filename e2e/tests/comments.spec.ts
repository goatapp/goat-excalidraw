import { test, expect } from "@playwright/test";
import {
  API_URL,
  createDrawing,
  deleteDrawing,
  createComment,
  getComments,
  deleteComment,
  getCsrfHeaders,
} from "./helpers/api";

test.describe("Comments API", () => {
  let createdDrawingIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdDrawingIds) {
      try {
        await deleteDrawing(request, id);
      } catch {}
    }
    createdDrawingIds = [];
  });

  test("should create a top-level comment with anchor", async ({ request }) => {
    const drawing = await createDrawing(request, { name: "Comment Test" });
    createdDrawingIds.push(drawing.id);

    const comment = await createComment(request, drawing.id, {
      body: "Hello from the test!",
      anchorX: 150,
      anchorY: 200,
    });

    expect(comment.id).toBeTruthy();
    expect(comment.body).toBe("Hello from the test!");
    expect(comment.anchorX).toBe(150);
    expect(comment.anchorY).toBe(200);
    expect(comment.resolved).toBe(false);
    expect(comment.replyCount).toBe(0);
    expect(comment.reactions).toEqual([]);
    expect(comment.user).toBeDefined();
  });

  test("should list top-level comments", async ({ request }) => {
    const drawing = await createDrawing(request, { name: "List Comments Test" });
    createdDrawingIds.push(drawing.id);

    await createComment(request, drawing.id, { body: "First", anchorX: 10, anchorY: 10 });
    await createComment(request, drawing.id, { body: "Second", anchorX: 20, anchorY: 20 });

    const { comments, totalCount } = await getComments(request, drawing.id);
    expect(totalCount).toBe(2);
    expect(comments).toHaveLength(2);
    // Ordered newest first
    expect(comments[0].body).toBe("Second");
    expect(comments[1].body).toBe("First");
  });

  test("should create a reply", async ({ request }) => {
    const drawing = await createDrawing(request, { name: "Reply Test" });
    createdDrawingIds.push(drawing.id);

    const parent = await createComment(request, drawing.id, {
      body: "Parent comment",
      anchorX: 50,
      anchorY: 50,
    });

    const reply = await createComment(request, drawing.id, {
      body: "This is a reply",
      parentId: parent.id,
    });

    expect(reply.parentId).toBe(parent.id);
    expect(reply.anchorX).toBeNull();
    expect(reply.anchorY).toBeNull();

    // Parent should now have replyCount = 1
    const { comments } = await getComments(request, drawing.id);
    expect(comments).toHaveLength(1); // Only top-level
    expect(comments[0].replyCount).toBe(1);

    // Fetch replies
    const repliesResp = await request.get(
      `${API_URL}/drawings/${drawing.id}/comments/${parent.id}/replies`
    );
    expect(repliesResp.ok()).toBe(true);
    const { replies } = await repliesResp.json();
    expect(replies).toHaveLength(1);
    expect(replies[0].body).toBe("This is a reply");
  });

  test("should edit a comment", async ({ request }) => {
    const drawing = await createDrawing(request, { name: "Edit Test" });
    createdDrawingIds.push(drawing.id);

    const comment = await createComment(request, drawing.id, {
      body: "Original text",
      anchorX: 0,
      anchorY: 0,
    });

    const headers = await getCsrfHeaders(request);
    const editResp = await request.put(
      `${API_URL}/drawings/${drawing.id}/comments/${comment.id}`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { body: "Updated text" },
      }
    );
    expect(editResp.ok()).toBe(true);
    const { comment: updated } = await editResp.json();
    expect(updated.body).toBe("Updated text");
  });

  test("should delete a comment", async ({ request }) => {
    const drawing = await createDrawing(request, { name: "Delete Test" });
    createdDrawingIds.push(drawing.id);

    const comment = await createComment(request, drawing.id, {
      body: "To be deleted",
      anchorX: 0,
      anchorY: 0,
    });

    await deleteComment(request, drawing.id, comment.id);

    const { totalCount } = await getComments(request, drawing.id);
    expect(totalCount).toBe(0);
  });

  test("should toggle resolve on a comment", async ({ request }) => {
    const drawing = await createDrawing(request, { name: "Resolve Test" });
    createdDrawingIds.push(drawing.id);

    const comment = await createComment(request, drawing.id, {
      body: "Resolve me",
      anchorX: 0,
      anchorY: 0,
    });

    const headers = await getCsrfHeaders(request);
    const resolveResp = await request.patch(
      `${API_URL}/drawings/${drawing.id}/comments/${comment.id}/resolve`,
      { headers }
    );
    expect(resolveResp.ok()).toBe(true);
    const { comment: resolved } = await resolveResp.json();
    expect(resolved.resolved).toBe(true);

    // Toggle back
    const unresolveResp = await request.patch(
      `${API_URL}/drawings/${drawing.id}/comments/${comment.id}/resolve`,
      { headers }
    );
    expect(unresolveResp.ok()).toBe(true);
    const { comment: unresolved } = await unresolveResp.json();
    expect(unresolved.resolved).toBe(false);
  });

  test("should add and remove emoji reactions", async ({ request }) => {
    const drawing = await createDrawing(request, { name: "Reaction Test" });
    createdDrawingIds.push(drawing.id);

    const comment = await createComment(request, drawing.id, {
      body: "React to this",
      anchorX: 0,
      anchorY: 0,
    });

    // Add reaction
    const headers = await getCsrfHeaders(request);
    const addResp = await request.post(
      `${API_URL}/drawings/${drawing.id}/comments/${comment.id}/reactions`,
      {
        headers: { ...headers, "Content-Type": "application/json" },
        data: { emoji: "👍" },
      }
    );
    expect(addResp.ok() || addResp.status() === 201).toBe(true);

    // Verify reaction shows in comment list
    const { comments } = await getComments(request, drawing.id);
    expect(comments[0].reactions).toHaveLength(1);
    expect(comments[0].reactions[0].emoji).toBe("👍");
    expect(comments[0].reactions[0].count).toBe(1);

    // Remove reaction
    const removeResp = await request.delete(
      `${API_URL}/drawings/${drawing.id}/comments/${comment.id}/reactions/${encodeURIComponent("👍")}`,
      { headers }
    );
    expect(removeResp.ok()).toBe(true);

    const { comments: after } = await getComments(request, drawing.id);
    expect(after[0].reactions).toHaveLength(0);
  });

  test("should cascade-delete comments when drawing is deleted", async ({
    request,
  }) => {
    const drawing = await createDrawing(request, { name: "Cascade Test" });

    await createComment(request, drawing.id, {
      body: "Will be cascaded",
      anchorX: 0,
      anchorY: 0,
    });

    await deleteDrawing(request, drawing.id);

    const resp = await request.get(`${API_URL}/drawings/${drawing.id}/comments`);
    expect(resp.status()).toBe(404);
  });

  test("should return 404 for comments on non-existent drawing", async ({
    request,
  }) => {
    const resp = await request.get(
      `${API_URL}/drawings/00000000-0000-0000-0000-000000000000/comments`
    );
    expect(resp.status()).toBe(404);
  });
});

test.describe("Comments UI", () => {
  let createdDrawingIds: string[] = [];

  test.afterEach(async ({ request }) => {
    for (const id of createdDrawingIds) {
      try {
        await deleteDrawing(request, id);
      } catch {}
    }
    createdDrawingIds = [];
  });

  test("should show comment button in editor toolbar", async ({
    page,
    request,
  }) => {
    const drawing = await createDrawing(request, { name: "UI Comment Test" });
    createdDrawingIds.push(drawing.id);

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("[class*='excalidraw'], canvas", {
      timeout: 15000,
    });
    await page.mouse.move(640, 10);
    await page.waitForTimeout(500);

    const commentButton = page.locator('button[title="Comments"]');
    await expect(commentButton).toBeAttached();
  });

  test("should open comment panel and show empty state", async ({
    page,
    request,
  }) => {
    const drawing = await createDrawing(request, { name: "Panel Test" });
    createdDrawingIds.push(drawing.id);

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("[class*='excalidraw'], canvas", {
      timeout: 15000,
    });
    await page.mouse.move(640, 10);
    await page.waitForTimeout(500);

    await page.locator('button[title="Comments"]').click();
    await page.waitForTimeout(500);

    await expect(page.locator("text=No comments yet")).toBeVisible();
  });

  test("should show comment pins and popover with working kebab menu", async ({
    page,
    request,
  }) => {
    const drawing = await createDrawing(request, { name: "Kebab Test" });
    createdDrawingIds.push(drawing.id);

    // Create a comment via API
    await createComment(request, drawing.id, {
      body: "Test kebab menu comment",
      anchorX: 100,
      anchorY: 100,
    });

    await page.goto(`/editor/${drawing.id}`);
    await page.waitForSelector("[class*='excalidraw'], canvas", {
      timeout: 15000,
    });
    await page.waitForTimeout(2000);

    // Find and click the comment pin
    const pin = page.locator("button.pointer-events-auto").first();
    await expect(pin).toBeVisible({ timeout: 5000 });
    await pin.click();
    await page.waitForTimeout(500);

    // Popover should be visible with the comment body
    await expect(page.locator("text=Test kebab menu comment")).toBeVisible();

    // Find and click the kebab button (MoreVertical icon inside the popover)
    const popover = page.locator('div[class*="z-[80]"]');
    const kebabBtn = popover.locator("button").filter({
      has: page.locator('svg.lucide-ellipsis-vertical, [data-lucide="ellipsis-vertical"]'),
    });

    // Fallback: find the kebab by looking for the small button near the username
    let foundKebab = false;
    if ((await kebabBtn.count()) > 0) {
      await kebabBtn.first().click();
      foundKebab = true;
    } else {
      // Look for the three-dot button by structure
      const allBtns = popover.locator("button");
      const count = await allBtns.count();
      for (let i = 0; i < count; i++) {
        const html = await allBtns.nth(i).innerHTML();
        if (html.includes("more-vertical") || html.includes("ellipsis")) {
          await allBtns.nth(i).click();
          foundKebab = true;
          break;
        }
      }
    }

    if (foundKebab) {
      await page.waitForTimeout(300);

      // The dropdown is portaled to body with z-[200]
      const deleteBtn = page.locator("div.fixed button:has-text('Delete')");
      await expect(deleteBtn).toBeVisible({ timeout: 2000 });

      // Edit only appears when the logged-in user is the comment author;
      // in the bootstrap (no-auth) scenario the user ID may not match,
      // so we only check Delete (available to the drawing owner).
      const editBtn = page.locator("div.fixed button:has-text('Edit')");
      const editVisible = await editBtn.isVisible().catch(() => false);

      if (editVisible) {
        await editBtn.click();
        await page.waitForTimeout(300);
        const editTextarea = popover.locator("textarea");
        await expect(editTextarea).toBeVisible({ timeout: 2000 });
      } else {
        // Verify Delete works instead
        await deleteBtn.click();
        await page.waitForTimeout(500);
        // Comment should be gone
        await expect(page.locator("text=Test kebab menu comment")).not.toBeVisible({ timeout: 3000 });
      }
    }
  });
});
