import { describe, it, expect } from "vitest";
import {
  shareIdFrom,
  isChatGptShareUrl,
  shareApiUrl,
  assistantMessages,
  conversationTitle,
  splitIntoItems,
} from "../src/lib/news/chatgpt";

const ID = "3f2504e0-4f89-41d3-9a0c-0305e82c3301";

describe("shareIdFrom", () => {
  it("reads a plain share link", () => {
    expect(shareIdFrom(`https://chatgpt.com/share/${ID}`)).toBe(ID);
  });

  it("accepts the older chat.openai.com host", () => {
    expect(shareIdFrom(`https://chat.openai.com/share/${ID}`)).toBe(ID);
  });

  it("ignores the tracking query a copied link carries", () => {
    expect(shareIdFrom(`https://chatgpt.com/share/${ID}?utm_source=whatsapp`)).toBe(ID);
  });

  it("handles the /share/e/ edit form and gizmo paths", () => {
    expect(shareIdFrom(`https://chatgpt.com/share/e/${ID}`)).toBe(ID);
    expect(shareIdFrom(`https://chatgpt.com/g/g-abc123/share/${ID}`)).toBe(ID);
  });

  it("is case-insensitive on the id and normalises it", () => {
    expect(shareIdFrom(`https://chatgpt.com/share/${ID.toUpperCase()}`)).toBe(ID);
  });

  it("rejects a conversation link, which is private and not shareable", () => {
    expect(shareIdFrom(`https://chatgpt.com/c/${ID}`)).toBeNull();
  });

  it("rejects other hosts, even with a share-shaped path", () => {
    expect(shareIdFrom(`https://evil.test/share/${ID}`)).toBeNull();
  });

  it("rejects junk", () => {
    expect(shareIdFrom("not a url")).toBeNull();
    expect(shareIdFrom("https://chatgpt.com/share/not-a-uuid")).toBeNull();
  });

  it("drives the boolean helper and the endpoint URL", () => {
    expect(isChatGptShareUrl(`https://chatgpt.com/share/${ID}`)).toBe(true);
    expect(isChatGptShareUrl("https://thepienews.com/feed/")).toBe(false);
    expect(shareApiUrl(ID)).toBe(`https://chatgpt.com/backend-api/share/${ID}`);
  });
});

/** The payload shape the share endpoint has used: an ordered conversation array. */
const LINEAR = {
  title: "Australia immigration — 4 Sep",
  linear_conversation: [
    {
      message: {
        author: { role: "user" },
        create_time: 1788500000,
        content: { content_type: "text", parts: ["Give me today's updates"] },
      },
    },
    {
      message: {
        author: { role: "assistant" },
        create_time: 1788500100,
        content: { content_type: "text", parts: ["## Visa fee rise\nFees increase from 1 October."] },
      },
    },
  ],
};

/** The other shape: a node graph keyed by id, in no particular order. */
const MAPPING = {
  title: "AHPRA",
  mapping: {
    b: {
      message: {
        author: { role: "assistant" },
        create_time: 1788500200,
        content: { parts: ["Second answer"] },
      },
    },
    a: {
      message: {
        author: { role: "assistant" },
        create_time: 1788500100,
        content: { parts: ["First answer"] },
      },
    },
    sys: {
      message: {
        author: { role: "system" },
        create_time: 1788500000,
        content: { parts: ["you are helpful"] },
      },
    },
  },
};

describe("assistantMessages", () => {
  it("takes the assistant's turns and drops the user's", () => {
    const msgs = assistantMessages(LINEAR);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].text).toContain("Visa fee rise");
  });

  it("reads the mapping shape and puts it back in time order", () => {
    expect(assistantMessages(MAPPING).map((m) => m.text)).toEqual(["First answer", "Second answer"]);
  });

  it("skips system turns", () => {
    expect(assistantMessages(MAPPING).some((m) => m.text.includes("helpful"))).toBe(false);
  });

  it("skips turns ChatGPT marks as hidden scaffolding", () => {
    const payload = {
      linear_conversation: [
        {
          message: {
            author: { role: "assistant" },
            metadata: { is_visually_hidden_from_conversation: true },
            content: { parts: ["internal"] },
          },
        },
      ],
    };
    expect(assistantMessages(payload)).toEqual([]);
  });

  it("keeps text parts and ignores non-text ones", () => {
    const payload = {
      linear_conversation: [
        {
          message: {
            author: { role: "assistant" },
            content: { parts: ["visible", { content_type: "image_asset_pointer", asset_pointer: "x" }] },
          },
        },
      ],
    };
    expect(assistantMessages(payload)[0].text).toBe("visible");
  });

  it("returns nothing for a payload it cannot read, rather than throwing", () => {
    expect(assistantMessages(null)).toEqual([]);
    expect(assistantMessages("nope")).toEqual([]);
    expect(assistantMessages({})).toEqual([]);
  });

  it("reads the conversation title", () => {
    expect(conversationTitle(LINEAR)).toBe("Australia immigration — 4 Sep");
    expect(conversationTitle({})).toBe("");
  });
});

describe("splitIntoItems", () => {
  it("splits a heading-structured digest into one item per heading", () => {
    const md = `# Daily update
## Student visa fee increase
The fee rises to $2,000 from 1 October. [Read more](https://immi.gov.au/fees)

## New skilled occupation list
Nursing remains on the list.`;
    const items = splitIntoItems(md);
    expect(items.map((i) => i.title)).toEqual([
      "Student visa fee increase",
      "New skilled occupation list",
    ]);
    expect(items[0].summary).toContain("rises to $2,000");
    expect(items[0].url).toBe("https://immi.gov.au/fees");
  });

  it("splits a numbered digest and lifts the bolded headline out of the body", () => {
    const md = `1. **Visa fee rise** — fees increase from 1 October.
2. **AHPRA update** — new English requirements apply.`;
    const items = splitIntoItems(md);
    expect(items.map((i) => i.title)).toEqual(["Visa fee rise", "AHPRA update"]);
    expect(items[0].summary).toContain("1 October");
  });

  it("splits a bulleted digest", () => {
    const md = `- Fee rise: applications cost more from October.
- Occupation list: nursing stays.`;
    expect(splitIntoItems(md).map((i) => i.title)).toEqual(["Fee rise", "Occupation list"]);
  });

  it("keeps prose as a single item rather than dropping it", () => {
    const md = "The department confirmed today that fees will rise. Further detail follows.";
    const items = splitIntoItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("The department confirmed today that fees will rise.");
  });

  it("strips markdown so nothing renders as literal punctuation", () => {
    const items = splitIntoItems("## **Bold** heading\nSome `code` and *emphasis*.");
    expect(items[0].title).toBe("Bold heading");
    expect(items[0].summary).toBe("Some code and emphasis.");
  });

  it("gives the same guid for the same headline, so a re-read files nothing twice", () => {
    const a = splitIntoItems("## Visa fee rise\nbody one");
    const b = splitIntoItems("## Visa fee rise\nbody two, edited later");
    expect(a[0].guid).toBe(b[0].guid);
  });

  it("gives different guids to different headlines", () => {
    const items = splitIntoItems("## One\na\n\n## Two\nb");
    expect(items[0].guid).not.toBe(items[1].guid);
  });

  it("folds a headline repeated within one answer", () => {
    const items = splitIntoItems("## Same\na\n\n## Same\nb");
    expect(items).toHaveLength(1);
  });

  it("returns nothing for empty input", () => {
    expect(splitIntoItems("   ")).toEqual([]);
  });

  it("finds a bare URL when the digest does not use markdown links", () => {
    const items = splitIntoItems("## Fee rise\nDetails at https://immi.gov.au/fees, effective October.");
    expect(items[0].url).toBe("https://immi.gov.au/fees");
  });
});
