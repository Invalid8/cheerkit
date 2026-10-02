import "/ui/define.js";

const examples = [
  {
    selector: ".brand--navy cheerkit-support",
    color: "#1c2b4a",
    name: "Kemi Lawal",
    title: "Buy Kemi a coffee",
    description: "If a letter helped you, a coffee keeps the next one coming.",
  },
  {
    selector: ".brand--green cheerkit-support",
    color: "#286044",
    name: "Ayo Bello",
    title: "Support Garden Journal",
    description: "Help keep practical growing notes free for everyone.",
  },
  {
    selector: ".brand--plum cheerkit-support",
    color: "#75405f",
    name: "Mira Okafor",
    title: "Support Small Press",
    description: "Your support helps publish the next independent story.",
  },
];

for (const example of examples) {
  const element = document.querySelector(example.selector);
  if (!element) continue;
  element.setAttribute("color", example.color);
  element.config = {
    name: example.name,
    title: example.title,
    description: example.description,
  };
}
