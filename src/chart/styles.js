// Returns the CSS string for the card's <style> block. Pulled out of the
// main render() template so render() stays readable. The handful of
// values that depend on config (icon sizes, font sizes, chart height) are
// passed in explicitly — the function is otherwise pure.
//
// Adding a new style rule that *only* references CSS variables (no
// JS-side values) is fine to add inline here. Adding one that needs a new
// runtime value means adding it to the parameter list.
export function cardStyles({
  iconsSize,
  currentTempSize,
  timeSize,
  dayDateSize,
  chartHeight,
  titlePresent,
  labelsSmallSize,
}) {
  return `
    ha-icon {
      color: var(--paper-item-icon-color);
    }
    img {
      width: ${iconsSize}px;
      height: ${iconsSize}px;
    }
    .card {
      padding-top: ${titlePresent ? '0px' : '16px'};
      padding-right: 16px;
      padding-bottom: 16px;
      padding-left: 16px;
    }
    .main {
      display: flex;
      align-items: center;
      font-size: ${currentTempSize}px;
      margin-bottom: 10px;
    }
    .main ha-icon {
      --mdc-icon-size: 50px;
      margin-right: 14px;
      margin-inline-start: initial;
      margin-inline-end: 14px;
    }
    .main img {
      width: ${iconsSize * 2}px;
      height: ${iconsSize * 2}px;
      margin-right: 14px;
      margin-inline-start: initial;
      margin-inline-end: 14px;
    }
    .main div {
      line-height: 0.9;
    }
    .main span {
      font-size: 18px;
      color: var(--secondary-text-color);
    }
    .attributes {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
      font-weight: 300;
      direction: ltr;
    }
    .chart-container {
      position: relative;
      height: ${chartHeight}px;
      width: 100%;
      direction: ltr;
    }
    .conditions {
      display: flex;
      justify-content: space-around;
      align-items: center;
      margin: 0px 5px 0px 5px;
      cursor: pointer;
    }
    .forecast-item {
      display: flex;
      flex-direction: column;
      align-items: center;
      margin: 1px;
    }
    .wind-details {
      display: flex;
      justify-content: space-around;
      align-items: flex-start;
      font-weight: 300;
    }
    /* Each per-day wind cell. flex-wrap lets the speed (.wind-value) drop
     * onto a second line when the column is too narrow to fit it next to
     * the arrow — keeps narrow charts readable without truncating. */
    .wind-detail {
      display: flex;
      flex: 1 1 0;
      min-width: 0;
      flex-wrap: wrap;
      justify-content: center;
      align-items: center;
      gap: 2px;
      margin: 1px;
    }
    .wind-detail ha-icon {
      --mdc-icon-size: 15px;
    }
    .wind-icon {
      position: relative;
      bottom: 1px;
    }
    /* Speed + unit travel together as one wrap unit so the unit doesn't
     * split off from its number on narrow columns. */
    .wind-value {
      display: inline-flex;
      align-items: center;
      gap: 1px;
      white-space: nowrap;
    }
    .wind-speed {
      font-size: 11px;
    }
    .wind-unit {
      font-size: ${labelsSmallSize}px;
    }
    .current-time {
      position: absolute;
      top: 20px;
      right: 16px;
      inset-inline-start: initial;
      inset-inline-end: 16px;
      font-size: ${timeSize}px;
    }
    .date-text {
      font-size: ${dayDateSize}px;
      color: var(--secondary-text-color);
    }
  `;
}
