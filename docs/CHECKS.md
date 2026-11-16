# Checks

Refusals identify the object, the observed value and the required value.
See [AUTHORING](AUTHORING.md#6-refusals-the-rule-and-what-has-to-change) for the full
command reference.

## Chest contour drafting warnings

`propose` drafts the uniquely largest chest-carrier art island. The existing dust
rule and proposal note remain unchanged. Non-dust extra islands may be omitted
only when each art-pixel count is strictly below the drafted `contour.spacing`
squared (`spacing²`). This threshold is a derived sampling-cell area policy;
an area below it does not prove that no vertex can lie inside a small island.

| Code | Warns | Action |
| --- | --- | --- |
| `PROPOSE_TORSO_ISLAND_LEFT_OUT` | A non-dust extra island is omitted because its art-pixel count is strictly below `spacing²`; the warning names its pixel count and bounding box in rig pixels. | Inspect the omitted art; `contour.stray` records the largest omitted island's art-pixel count, including dust. Separate the piece if it must be meshed. |

Equal-largest island ties and any non-dust extra island at or above `spacing²`
refuse with `PROPOSE_TORSO_ISLANDS`, whose detail includes the threshold. No art
also refuses with that code. See [Drafting the chest carrier](AUTHORING.md#drafting-the-chest-carrier).

## Edited rig-space parts

The following checks apply only when `assemble.edited_parts` is declared.
They run before output emission; refusal preserves a missing output directory
and all files in a preexisting successful output.

| Code | Refuses | Remedy |
| --- | --- | --- |
| `ASSEMBLE_EDITED_PART_UNKNOWN` | A receipt names a part outside the base plan. | Use the existing base-plan part name; a new name needs a plan change. |
| `ASSEMBLE_EDITED_PART_FILE` | The receipt file does not exist at dir/file. | Correct the config-relative dir or the directory-relative file, or supply that file. |
| `ASSEMBLE_EDITED_PART_SHA256` | The edited file bytes do not match sha256. | Use the intended edited file and record its exact file hash. |
| `ASSEMBLE_EDITED_PART_BASELINE` | The current normal assembled part PNG does not match from_sha256. | Rebase the edit on this config's current assembled part and record that original file hash. |
| `ASSEMBLE_EDITED_PART_SIZE` | The edited PNG width or height differs from the assembled box. | Edit at the original crop and rig-pixel size; use a plan change for a new box. |
| `ASSEMBLE_EDITED_PART_DUPLICATE` | More than one receipt names the same part. | Keep exactly one receipt for that part. |
| `ASSEMBLE_EDITED_PART_DECODES` | The verified file cannot be decoded as a PNG. | Supply a valid PNG and update its receipt hash. |

Malformed block and receipt fields use the config loader's `CONFIG_FIELD_TYPE`,
`CONFIG_FIELD_PRESENT` or `CONFIG_KEY_KNOWN` checks. Metadata uses the strict
parts reader's `PARTS_FIELD_TYPE` and `PARTS_COUNTS_ADD_UP` checks for the receipt
association and its census. See [the field contract](AUTHORING.md#edited-rig-space-parts-assembleedited_parts-issue-1278).
