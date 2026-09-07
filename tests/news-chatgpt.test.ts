import { describe, it, expect } from "vitest";
import {
  shareIdFrom,
  isChatGptShareUrl,
  shareApiUrl,
  assistantMessages,
  conversationTitle,
  splitIntoItems,
  isSharedTaskUrl,
  looksLikeSharedAutomation,
  SHARED_TASK_GUIDANCE,
  stripCitations,
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

  it("does NOT split a briefing on its own bullet points", () => {
    // The behaviour a real briefing forced. Splitting here yielded items titled
    // "190 ROIs waiting" with a body of "908" — row labels as headlines and bare
    // numbers as news. The figures are the briefing's contents, not five updates.
    const md = `Australia PR / ROI update — 4 September 2026

Tasmania completed another weekly ROI round on 3 September.

Current position:
- 190 ROIs waiting: 908
- 491 ROIs waiting: 592
- 190 nomination places still available: 1,036`;
    const items = splitIntoItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Australia PR / ROI update — 4 September 2026");
    expect(items[0].summary).toContain("908");
    expect(items[0].summary).toContain("Tasmania completed");
  });

  it("does not split a numbered list either — same reasoning", () => {
    const md = `Daily update

1. Fees increase from 1 October.
2. New English requirements apply.`;
    const items = splitIntoItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Daily update");
  });

  it("keeps prose as a single item rather than dropping it", () => {
    const md = "The department confirmed today that fees will rise. Further detail follows.";
    const items = splitIntoItems(md);
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("The department confirmed today that fees will rise. Further detail follows.");
  });

  it("keeps a whole briefing, not a 600-character teaser", () => {
    // These items are the article, not a pointer to one — there is nowhere else
    // for a reader to go for the rest.
    const body = "Detail sentence. ".repeat(120);
    const items = splitIntoItems(`Australia PR / ROI update — 4 September 2026\n\n${body}`);
    expect(items[0].summary.length).toBeGreaterThan(1500);
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

describe("backfilling an existing chat", () => {
  it("keeps every point of a long multi-day chat, not just the first few", () => {
    // The question this answers: "I have weeks of updates in one chat — do I get
    // the old ones?" Splitting must scale past a feed-sized handful, because a
    // shared chat is pasted once and never re-read for more.
    const md = Array.from({ length: 120 }, (_, i) => `## Update ${i + 1}\nBody ${i + 1}.`).join("\n\n");
    const items = splitIntoItems(md);
    expect(items).toHaveLength(120);
    expect(items[0].title).toBe("Update 1");
    expect(items[119].title).toBe("Update 120");
  });

  it("gives every point its own identity, so none collapse into one another", () => {
    const md = Array.from({ length: 40 }, (_, i) => `## Update ${i + 1}\nBody.`).join("\n\n");
    const guids = new Set(splitIntoItems(md).map((i) => i.guid));
    expect(guids.size).toBe(40);
  });

  it("collects answers from every turn of a chat appended to over days", () => {
    const payload = {
      linear_conversation: [
        { message: { author: { role: "user" }, create_time: 1788500000, content: { parts: ["day 1?"] } } },
        { message: { author: { role: "assistant" }, create_time: 1788500100, content: { parts: ["## Day one item\nx"] } } },
        { message: { author: { role: "user" }, create_time: 1788600000, content: { parts: ["day 2?"] } } },
        { message: { author: { role: "assistant" }, create_time: 1788600100, content: { parts: ["## Day two item\ny"] } } },
      ],
    };
    const answers = assistantMessages(payload);
    expect(answers).toHaveLength(2);
    const titles = answers.flatMap((a) => splitIntoItems(a.text)).map((i) => i.title);
    expect(titles).toEqual(["Day one item", "Day two item"]);
  });
});

describe("shared task links (/s/task_…)", () => {
  // These are what an admin actually reaches for first, because ChatGPT's own
  // Share button on a scheduled task hands them one. They publish the task's
  // recipe and never its output, so they must be refused, not polled.
  const TASK = "https://chatgpt.com/s/task_636372758dac8191be6a3f871ef59e51";

  it("recognises a shared-task link", () => {
    expect(isSharedTaskUrl(TASK)).toBe(true);
    expect(isSharedTaskUrl("https://chatgpt.com/s/task_7aff05a0dd7881919d3074694c2fa799")).toBe(true);
  });

  it("does not mistake a real conversation share for one", () => {
    expect(isSharedTaskUrl(`https://chatgpt.com/share/${ID}`)).toBe(false);
  });

  it("does not treat a task link as an importable share", () => {
    // Guards the trap that produced "working · 0 updates" forever: the share-id
    // reader must not half-accept a task link.
    expect(shareIdFrom(TASK)).toBeNull();
    expect(isChatGptShareUrl(TASK)).toBe(false);
  });

  it("ignores other hosts", () => {
    expect(isSharedTaskUrl("https://evil.test/s/task_abc")).toBe(false);
  });

  it("recognises a shared automation from the page it serves", () => {
    // The shape ChatGPT's router payload actually ships, escaped as it appears
    // in the HTML.
    const body = String.raw`streamController.enqueue("[{\"kind\",\"shared_automation\",\"title\"...")`;
    expect(looksLikeSharedAutomation(body)).toBe(true);
  });

  it("does not flag an ordinary page", () => {
    expect(looksLikeSharedAutomation("<html><body>news</body></html>")).toBe(false);
  });

  it("tells the admin what to paste instead", () => {
    expect(SHARED_TASK_GUIDANCE).toContain("chatgpt.com/share/");
  });
});

describe("a real shared conversation", () => {
  // Modelled on the payload chatgpt.com/backend-api/share/<id> actually returns
  // for a scheduled task's conversation — including the turns that are not the
  // answer, which is what made the first version publish nonsense.
  const REAL = {
    title: "Permanent Residency Update",
    linear_conversation: [
      { message: { author: { role: "system" }, content: { content_type: "text", parts: [""] } } },
      { message: { author: { role: "user" }, create_time: 1788500000, content: { content_type: "text", parts: ["I need PR updates"] } } },
      {
        // The model thinking out loud before it acts.
        message: {
          author: { role: "assistant" },
          channel: "commentary",
          create_time: 1788500100,
          content: { content_type: "text", parts: ["I can set this as a daily Australia PR/ROI briefing, focused on…"] },
        },
      },
      {
        // The scheduled task's own JSON definition, as a tool call.
        message: {
          author: { role: "assistant" },
          channel: "commentary",
          recipient: "de1d73e.create",
          create_time: 1788500150,
          content: { content_type: "code", text: '{"title":"Australia PR ROI Update","prompt":"Send me a daily…"}' },
        },
      },
      { message: { author: { role: "tool" }, name: "de1d73e.create", content: { content_type: "text", parts: ["The output of this plugin was redacted."] } } },
      {
        message: {
          author: { role: "assistant" },
          channel: "final",
          create_time: 1788700000,
          content: {
            content_type: "text",
            parts: [
              "Australia PR / ROI update — 4 September 2026\n\nTasmania issued 34 subclass 190 invitations. citeturn446605view0\n\nThe lowest ROI score dropped to 519. citeturn446605view0",
            ],
          },
        },
      },
    ],
  };

  const answers = assistantMessages(REAL);

  it("keeps only the answer the reader saw", () => {
    expect(answers).toHaveLength(1);
    expect(answers[0].text).toContain("Australia PR / ROI update");
  });

  it("drops the model's commentary turn", () => {
    expect(answers.some((a) => a.text.includes("I can set this as a daily"))).toBe(false);
  });

  it("never publishes a tool call — the task's own JSON is not news", () => {
    // This one reached the feed in the first version, as an update whose
    // headline was a raw JSON blob.
    expect(answers.some((a) => a.text.includes('"prompt"'))).toBe(false);
  });

  it("strips the private-use citation markup out of the body", () => {
    expect(answers[0].text).not.toMatch(/[\uE200-\uE20F]/);
    expect(answers[0].text).not.toContain("cite");
    expect(answers[0].text).not.toContain("turn446605");
  });

  it("produces one dated briefing, headline first", () => {
    const items = answers.flatMap((a) => splitIntoItems(a.text));
    expect(items).toHaveLength(1);
    expect(items[0].title).toBe("Australia PR / ROI update — 4 September 2026");
    expect(items[0].summary).toContain("34 subclass 190 invitations");
  });

  it("gives each day its own identity, since the date is in the headline", () => {
    const day3 = splitIntoItems("Australia PR / ROI update — 3 September 2026\n\nbody");
    const day4 = splitIntoItems("Australia PR / ROI update — 4 September 2026\n\nbody");
    expect(day3[0].guid).not.toBe(day4[0].guid);
  });
});

describe("stripCitations", () => {
  it("removes a citation span whole", () => {
    expect(
      stripCitations("Rounds started 20 August. \uE200cite\uE202turn982260search0\uE201"),
    ).toBe("Rounds started 20 August.");
  });

  it("leaves ordinary text alone", () => {
    expect(stripCitations("No citations here.")).toBe("No citations here.");
  });
});

describe("a share link is read as a chat whatever mode is selected", () => {
  // The failure this prevents: the admin picks "Watch the page" (the mode they
  // used for their earlier sources), and the share URL then yields a
  // client-rendered shell with zero characters of text. The source reports
  // "working" indefinitely and publishes nothing.
  const SHARE = "https://chatgpt.com/share/6a9e5149-e73c-83e8-8e57-e72979726f99";

  it("recognises the admin's real share link", () => {
    expect(isChatGptShareUrl(SHARE)).toBe(true);
    expect(shareIdFrom(SHARE)).toBe("6a9e5149-e73c-83e8-8e57-e72979726f99");
  });

  it("accepts a share id that is not a v4 UUID", () => {
    // The real one is not v4 — reading the version nibble strictly would have
    // rejected the only link that matters.
    expect(shareIdFrom("https://chatgpt.com/share/6a9e5149-e73c-83e8-8e57-e72979726f99")).not.toBeNull();
  });

  it("is not confused into treating a feed URL as a chat", () => {
    expect(isChatGptShareUrl("https://thepienews.com/feed/")).toBe(false);
  });
});

describe("updates carry no ChatGPT link", () => {
  it("never offers the shared chat as an item link", () => {
    // The briefing is published as text; the shared chat is how the desk sources
    // it, not somewhere staff should be sent.
    const items = splitIntoItems(
      "## Fee rise\nSee the chat at https://chatgpt.com/share/6a9e5149-e73c-83e8-8e57-e72979726f99 for detail.",
    );
    expect(items[0].url).toBe("");
  });

  it("still keeps a cited official source", () => {
    const items = splitIntoItems("## Fee rise\nDetails at https://immi.homeaffairs.gov.au/fees today.");
    expect(items[0].url).toBe("https://immi.homeaffairs.gov.au/fees");
  });

  it("skips a ChatGPT link to reach a real one", () => {
    const items = splitIntoItems(
      "## Fee rise\n[chat](https://chatgpt.com/share/abc) and https://immi.homeaffairs.gov.au/fees",
    );
    expect(items[0].url).toBe("https://immi.homeaffairs.gov.au/fees");
  });
});
