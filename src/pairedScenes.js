// Built-in paired (two-person) shots — one image prompt + one video prompt
// per shot, ready to drop into a project as a pre-filled scene.
// The shot's prompts are stored verbatim on the scene, so Images to Create
// and the Bible show them exactly as written (hand-edited prompts are
// never overwritten except by an explicit "Reset all").
//
// First entry: Marina the mermaid + Caspian the sailor (Salt for the Guilt).
// Lyric is the line spotted on screen in Salt for the Guilt (~125s).
export const PAIRED_SHOTS = [
  {
    id: 'paired-marina-caspian',
    title: 'Marina + Caspian — paired shot',
    presetIds: ['builtin-w23', 'builtin-m22'],
    lyrics: 'Pull the heavy water over your eyes.',
    imagePrompt: `Create a two-person full-body character portrait image in 9:16 vertical

SUBJECT: Two characters meeting on a moonlit shore — Marina, a beautiful mermaid, and Caspian, a young sailor. Marina has sun-kissed skin with a faint iridescent shimmer and sea-green scales fading up her hips. She has a soft and otherworldly face, sea-green eyes, full lips, delicate gills at her neck, tiny pearls woven through her hair, and webbed fingers. Her long flowing sea-green hair has strands of gold and drifts like kelp. She wears a crown of white coral and pearls, a pearl necklace, and her bare shoulders rise above a shimmering teal-and-gold scaled tail with seashell adornments. She holds a conch shell in one hand. Caspian has sun-bronzed skin and salt-wind weathering. He is tall and lean-muscled, 6'1", with a strong jaw, short dark stubble, and storm-grey eyes. A thin scar crosses one eyebrow, an anchor tattoo marks his forearm, and a compass rose tattoo sits on his chest. His dark windswept hair is damp with sea spray, and his navy sailor cap is tilted back. He wears a navy peacoat open over a striped sailor shirt, dark trousers, and worn leather boots. Accessories: a brass compass on a chain, a coiled rope over one shoulder, and a lantern in one hand.

POSE & ACTION: Marina perches on a wave-washed rock at the water's edge, her tail curled in the shallows, one hand lifting her flowing hair back from her face, the other reaching toward the shore. Caspian stands on the sand beside the beached rowboat, lantern raised in one hand, his other hand reaching toward her, gazing at her as if he has just heard her song over the waves. Their hands almost touch across the gap between rock and shore.

SCENE: A moonlit rocky shore at the edge of a stormy sea, with a beached rowboat on the sand and a tall ship anchored in the distance.

ENVIRONMENT: Foreground — tide pools, white foam, and scattered seashells on wet sand. Midground — Marina on the rocks at the water's edge, Caspian beside the beached rowboat, a lit lantern on the sand between them. Background — a stormy dark sea under a full moon in a deep teal sky, the tall ship silhouetted on the horizon. Props — wave-washed rocks, seashells, beached rowboat, lantern, conch shell, brass compass.

CAMERA: Two-person full-body shot, eye level with a slight low angle, both characters centered in frame, Marina head to tail and Caspian head to boots fully visible.

LIGHTING: Cool silver moonlight from behind, warm golden lantern glow on their faces, soft shimmer on the water and wet sand.

COLOR & MOOD: Deep teal, sea-green, navy, gold, and silver. Mood: haunting, enchanting, longing — a song half-heard over the waves, a sailor who heard it and stayed.

STYLE & QUALITY: Modern graphic novel comic art style, crisp ink linework, cel-shaded dramatic lighting, highly detailed, sharp focus, cinematic.

CONSISTENCY: Always keep the same identifying features: Marina — sun-kissed skin with a faint iridescent shimmer, sea-green scales fading up her hips, long flowing sea-green hair with strands of gold, delicate gills at her neck, tiny pearls woven through her hair, crown of white coral and pearls, shimmering teal-and-gold scaled tail, pearl necklace. Caspian — sun-bronzed skin, dark windswept hair damp with sea spray, navy sailor cap tilted back, storm-grey eyes, thin scar across one eyebrow, anchor tattoo on his forearm, compass rose tattoo on his chest, brass compass on a chain, navy peacoat over a striped sailor shirt.

AVOID: No extra limbs, no distorted hands or fingers, no legs instead of a tail for Marina, no extra characters, no text, no watermark, no blurry or low-detail rendering, no chibi or cartoonish proportions.

VIDEO PREPARATION: Start frame is this image. Slow dolly-in toward the pair, Marina's hair drifting in the sea breeze, her tail swaying gently in the shallows, Caspian's lantern light flickering, waves lapping at the rocks, moonlight shimmering on the water. 8-second clip. Lyric for this shot (spotted on screen in Salt for the Guilt, ~125s): "Pull the heavy water over your eyes."`,
    videoPrompt: `Start from the paired keyframe image: Marina on the wave-washed rock at the water's edge and Caspian on the sand beside the beached rowboat, lantern raised, their hands almost touching.

Slow dolly-in toward the pair. Marina's sea-green hair drifts in the sea breeze, her teal-and-gold tail sways gently in the shallows, Caspian's peacoat stirs and his lantern light flickers, waves lap at the rocks and moonlight shimmers on the water. Their hands drift closer but do not quite meet. 8-second clip. Lyric: "Pull the heavy water over your eyes."`,
  },
];
