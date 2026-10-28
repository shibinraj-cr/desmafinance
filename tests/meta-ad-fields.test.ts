import { describe, it, expect } from "vitest";
import { metaAdField } from "@/lib/meta-ad-fields";

describe("metaAdField", () => {
  it("reads the ad set and ad names whatever the header spelling", () => {
    const extra = { campaign: "Tab A", "Ad Set Name": "Kerala nurses 25-35", ad_name: "Video v2" };
    expect(metaAdField(extra, "adset")).toBe("Kerala nurses 25-35");
    expect(metaAdField(extra, "ad")).toBe("Video v2");
    expect(metaAdField({ adset_name: "Gulf RN" }, "adset")).toBe("Gulf RN");
  });
  it("falls back to the id when the sheet only carries ids", () => {
    expect(metaAdField({ adset_id: "120210000" }, "adset")).toBe("id 120210000");
  });
  it("does not mistake the campaign column for an ad set", () => {
    expect(metaAdField({ campaign: "Tab A", campaign_name: "Lead gen Oct" }, "adset")).toBeNull();
  });
  it("is null for no extra at all", () => {
    expect(metaAdField(null, "ad")).toBeNull();
    expect(metaAdField(["x"], "ad")).toBeNull();
  });
});
