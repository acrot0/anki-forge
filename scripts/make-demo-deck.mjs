/**
 * Build the Kaoyan English demo deck: 30 high-frequency words with phonetics,
 * definitions and examples, exported as a styled .apkg (vocab notetype).
 * Ships on the Release as a try-it sample — importing it is the user's call.
 */
import { writeApkgBytes } from '../src/apkg.mjs';
import { writeFile, mkdir } from 'node:fs/promises';

const WORDS = [
  ['abandon', '/əˈbændən/', 'v. 放弃，抛弃', 'He was forced to abandon the plan.'],
  ['abundant', '/əˈbʌndənt/', 'adj. 丰富的，充裕的', 'The region has abundant natural resources.'],
  ['accelerate', '/əkˈseləreɪt/', 'v. 加速，促进', 'Global warming has accelerated the melting of glaciers.'],
  ['accommodate', '/əˈkɒmədeɪt/', 'v. 容纳；使适应', 'The hall can accommodate 500 people.'],
  ['accumulate', '/əˈkjuːmjəleɪt/', 'v. 积累，积聚', 'Fat tends to accumulate around the waist.'],
  ['acquire', '/əˈkwaɪə(r)/', 'v. 获得，习得', 'Children acquire language remarkably fast.'],
  ['advocate', '/ˈædvəkeɪt/', 'v./n. 提倡（者）', 'She advocates a balanced diet for children.'],
  ['alleviate', '/əˈliːvieɪt/', 'v. 减轻，缓解', 'The medicine alleviated his pain quickly.'],
  ['ambiguous', '/æmˈbɪɡjuəs/', 'adj. 模棱两可的', 'His answer was deliberately ambiguous.'],
  ['anticipate', '/ænˈtɪsɪpeɪt/', 'v. 预期，预料', 'We anticipate strong opposition to the plan.'],
  ['arbitrary', '/ˈɑːbɪtrəri/', 'adj. 任意的，武断的', 'The rule seems completely arbitrary.'],
  ['authentic', '/ɔːˈθentɪk/', 'adj. 真实的，正宗的', 'The museum holds an authentic Ming vase.'],
  ['autonomous', '/ɔːˈtɒnəməs/', 'adj. 自主的，自治的', 'The region became fully autonomous in education.'],
  ['bureaucracy', '/bjʊəˈrɒkrəsi/', 'n. 官僚机构，官僚作风', 'Excessive bureaucracy slows everything down.'],
  ['coincide', '/ˌkəʊɪnˈsaɪd/', 'v. 巧合；一致', 'My views coincide with hers on education.'],
  ['compensate', '/ˈkɒmpenseɪt/', 'v. 补偿，弥补', 'Nothing can compensate for the loss of time.'],
  ['comprehensive', '/ˌkɒmprɪˈhensɪv/', 'adj. 全面的，综合的', 'The report gives a comprehensive analysis.'],
  ['conceive', '/kənˈsiːv/', 'v. 构想，设想', 'He could not conceive of life without books.'],
  ['condemn', '/kənˈdem/', 'v. 谴责，判刑', 'World leaders condemned the attack.'],
  ['confine', '/kənˈfaɪn/', 'v. 限制，禁闭', 'Please confine your remarks to the topic.'],
  ['conform', '/kənˈfɔːm/', 'v. 符合，遵从', 'All products must conform to safety standards.'],
  ['contemplate', '/ˈkɒntəmpleɪt/', 'v. 沉思，考虑', 'She contemplated changing her career.'],
  ['contradict', '/ˌkɒntrəˈdɪkt/', 'v. 反驳，与…矛盾', 'The two reports contradict each other.'],
  ['convey', '/kənˈveɪ/', 'v. 传达，运送', 'Words can hardly convey how grateful I am.'],
  ['crucial', '/ˈkruːʃl/', 'adj. 至关重要的', 'Reading plays a crucial role in learning.'],
  ['deteriorate', '/dɪˈtɪəriəreɪt/', 'v. 恶化，变坏', 'His health deteriorated rapidly last winter.'],
  ['discriminate', '/dɪˈskrɪmɪneɪt/', 'v. 歧视；区分', 'The law forbids discriminating against the disabled.'],
  ['eliminate', '/ɪˈlɪmɪneɪt/', 'v. 消除，淘汰', 'We aim to eliminate waste in production.'],
  ['facilitate', '/fəˈsɪlɪteɪt/', 'v. 促进，使便利', 'The new system facilitates online learning.'],
  ['fundamental', '/ˌfʌndəˈmentl/', 'adj. 基本的，根本的', 'Honesty is a fundamental value.'],
];

const cards = WORDS.map(([word, phonetic, definition, example]) => ({
  word, phonetic, definition, example,
  tags: ['考研英语', '高频词', word[0].toUpperCase()],
}));

const bytes = await writeApkgBytes(cards, { deckName: 'anki-forge 示例::考研英语高频词', style: 'vocab' });
await mkdir('demo', { recursive: true });
await writeFile('demo/kaoyan-english-demo.apkg', bytes);
console.log(`demo deck written: ${cards.length} cards, ${bytes.length} bytes -> demo/kaoyan-english-demo.apkg`);
