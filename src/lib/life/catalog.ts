// ライフインテリジェンスの初期データ（カテゴリと「何の情報か」の一覧）。
// データベースの準備のたびに「なければ追加」されます（あなたが変えた内容は上書きしません）。
// 項目を増やしたいときは、ここに足すか、AI社員が提案して増やします。

export type LifeCategorySeed = { id: string; name: string; description: string; sort_order: number };

export const LIFE_CATEGORIES: LifeCategorySeed[] = [
  { id: "money", name: "家計・資産", description: "収入・固定費・変動費・貯蓄・投資", sort_order: 1 },
  { id: "home", name: "住居・生活環境", description: "家賃・光熱費・通信費・家具家電・住まいの困りごと", sort_order: 2 },
  { id: "car", name: "車・移動", description: "車の維持費・保険・車検・移動時間", sort_order: 3 },
  { id: "health", name: "健康・運動", description: "体重・運動・睡眠・食生活", sort_order: 4 },
  { id: "pet", name: "ペット", description: "ペットの情報・健康・費用", sort_order: 5 },
  { id: "work", name: "仕事・学習", description: "仕事内容・労働時間・悩み・資格・目標", sort_order: 6 },
  { id: "hobby", name: "趣味・個人プロジェクト", description: "趣味・開発中のもの・個人的な目標", sort_order: 7 },
];

export type LifeFieldSeed = {
  id: string;
  category_id: string;
  label: string;
  value_type: "number" | "text" | "choice";
  unit?: string;
  choices?: string[];
  kind?: "state" | "periodic";
  period?: "none" | "week" | "month";
  refresh_days: number;
  importance: number;
  question: string;
  reason: string;
  depends_on?: string;
  sort_order: number;
};

const YEN = "円/月";

export const LIFE_FIELDS: LifeFieldSeed[] = [
  // ----- 家計・資産 -----
  { id: "income_monthly", category_id: "money", label: "毎月の手取り収入", value_type: "number", unit: YEN, refresh_days: 180, importance: 4, question: "毎月の手取り収入は、だいたいいくらですか？", reason: "家計全体のバランスを見るための基本の数字です", sort_order: 1 },
  { id: "savings_monthly", category_id: "money", label: "毎月の貯蓄額", value_type: "number", unit: YEN, refresh_days: 90, importance: 4, question: "毎月、だいたいいくら貯金していますか？", reason: "貯金のペースの変化に気づくためです", sort_order: 2 },
  { id: "savings_total", category_id: "money", label: "貯蓄の合計", value_type: "number", unit: "円", refresh_days: 90, importance: 2, question: "いまの貯金の合計は、だいたいいくらですか？（言いたくなければスキップでOK）", reason: "貯金が増えているかを見るためです", sort_order: 3 },
  { id: "food_monthly", category_id: "money", label: "食費（月）", value_type: "number", unit: "円", kind: "periodic", period: "month", refresh_days: 30, importance: 4, question: "{period}の食費は、だいたいいくらでしたか？", reason: "食費の増え方・減り方を見るためです", sort_order: 4 },
  { id: "spending_concern", category_id: "money", label: "気になった支出", value_type: "text", kind: "periodic", period: "month", refresh_days: 30, importance: 3, question: "{period}、お金の使い方で気になったことはありましたか？", reason: "ムダな出費やくり返す出費を見つけるためです", sort_order: 5 },
  { id: "subscriptions", category_id: "money", label: "使っているサブスク", value_type: "text", refresh_days: 180, importance: 4, question: "毎月払っているサブスク（動画・音楽・アプリなど）を、思いつくだけ教えてください（だいたいの金額もあれば）", reason: "あまり使っていない契約がないか確かめるためです", sort_order: 6 },
  { id: "investment", category_id: "money", label: "投資", value_type: "text", refresh_days: 365, importance: 2, question: "投資（積立など）をしていますか？していれば、だいたいの内容を教えてください", reason: "お金の置き場所のバランスを見るためです", sort_order: 7 },
  // ----- 住居・生活環境 -----
  { id: "rent", category_id: "home", label: "家賃（住宅費）", value_type: "number", unit: YEN, refresh_days: 180, importance: 5, question: "毎月の家賃（住宅ローンなども含む住まいの費用）は、いくらですか？", reason: "いちばん大きい固定費なので、まず知っておきたい数字です", sort_order: 1 },
  { id: "phone_bill", category_id: "home", label: "携帯電話料金", value_type: "number", unit: YEN, refresh_days: 180, importance: 5, question: "携帯電話の料金は、毎月いくらですか？（家族分を払っていれば合計で）", reason: "相場より高くなっていないか見るためです", sort_order: 2 },
  { id: "internet_bill", category_id: "home", label: "インターネット料金", value_type: "number", unit: YEN, refresh_days: 180, importance: 4, question: "家のインターネット料金は、毎月いくらですか？（ない場合は0）", reason: "通信費全体を見直すためです", sort_order: 3 },
  { id: "utilities_monthly", category_id: "home", label: "電気・ガス・水道代（月）", value_type: "number", unit: "円", kind: "periodic", period: "month", refresh_days: 30, importance: 4, question: "{period}の電気・ガス・水道代は、合計でだいたいいくらでしたか？", reason: "季節による変化や、急な増え方に気づくためです", sort_order: 4 },
  { id: "home_issue", category_id: "home", label: "住まいの困りごと", value_type: "text", refresh_days: 90, importance: 2, question: "家や部屋で、困っていること・不便なことはありますか？（家電の調子なども）", reason: "直せること・買い替え時期を見つけるためです", sort_order: 5 },
  { id: "contract_change", category_id: "home", label: "契約・サービスの変更", value_type: "text", refresh_days: 180, importance: 3, question: "この半年で、契約やサービス（保険・通信・電気など）に変更はありましたか？", reason: "固定費の情報を新しくしておくためです", sort_order: 6 },
  // ----- 車・移動 -----
  { id: "car_owned", category_id: "car", label: "車を持っているか", value_type: "choice", choices: ["はい", "いいえ"], refresh_days: 365, importance: 3, question: "車を持っていますか？", reason: "車の費用について聞くかどうかを決めるためです", sort_order: 1 },
  { id: "car_cost_monthly", category_id: "car", label: "車の維持費", value_type: "number", unit: YEN, refresh_days: 180, importance: 4, question: "車の維持費（ガソリン・駐車場・保険などの合計）は、月にだいたいいくらですか？", reason: "大きな固定費なので、増え方を見るためです", depends_on: "car_owned=はい", sort_order: 2 },
  { id: "car_inspection", category_id: "car", label: "次の車検・点検の時期", value_type: "text", refresh_days: 365, importance: 2, question: "次の車検（または点検）は、いつごろですか？", reason: "まとまった出費の時期を前もって知るためです", depends_on: "car_owned=はい", sort_order: 3 },
  { id: "commute_minutes", category_id: "car", label: "通勤・移動の時間", value_type: "number", unit: "分/日", refresh_days: 180, importance: 2, question: "通勤や毎日の移動に、1日あたりだいたい何分かかっていますか？", reason: "時間の使い方を見直すきっかけにするためです", sort_order: 4 },
  // ----- 健康・運動 -----
  { id: "exercise_week", category_id: "health", label: "運動（週）", value_type: "choice", choices: ["ほぼしていない", "1〜2回", "3〜4回", "5回以上"], kind: "periodic", period: "week", refresh_days: 7, importance: 3, question: "{period}は、運動（散歩も含む）を何回くらいしましたか？", reason: "運動のペースの変化に気づくためです", sort_order: 1 },
  { id: "weight", category_id: "health", label: "体重", value_type: "number", unit: "kg", kind: "periodic", period: "month", refresh_days: 30, importance: 2, question: "いまの体重は、だいたい何kgですか？（言いたくなければスキップでOK）", reason: "体重の変化を見るためです", sort_order: 2 },
  { id: "sleep_hours", category_id: "health", label: "睡眠時間", value_type: "number", unit: "時間/日", refresh_days: 90, importance: 3, question: "ふだん、1日に何時間くらい寝ていますか？", reason: "疲れや体調の原因に気づくためです", sort_order: 3 },
  { id: "diet_note", category_id: "health", label: "食生活", value_type: "text", refresh_days: 90, importance: 2, question: "食生活で気になっていることはありますか？（外食が多い、朝ごはんを抜くなど）", reason: "健康と食費の両方に関わるためです", sort_order: 4 },
  // ----- ペット -----
  { id: "pet_owned", category_id: "pet", label: "ペットを飼っているか", value_type: "choice", choices: ["いる", "いない"], refresh_days: 365, importance: 2, question: "ペットを飼っていますか？", reason: "ペットについて聞くかどうかを決めるためです", sort_order: 1 },
  { id: "pet_info", category_id: "pet", label: "ペットの情報", value_type: "text", refresh_days: 365, importance: 2, question: "どんなペットですか？（種類・年齢・名前など、教えてもいい範囲で）", reason: "ペットに合った提案をするためです", depends_on: "pet_owned=いる", sort_order: 2 },
  { id: "pet_cost_monthly", category_id: "pet", label: "ペットの費用", value_type: "number", unit: YEN, refresh_days: 180, importance: 2, question: "ペットにかかる費用（ごはん・消耗品・病院など）は、月にだいたいいくらですか？", reason: "ペットの費用の変化に気づくためです", depends_on: "pet_owned=いる", sort_order: 3 },
  { id: "pet_health", category_id: "pet", label: "ペットの健康", value_type: "text", refresh_days: 90, importance: 2, question: "ペットの体調で、気になっていることはありますか？", reason: "早めに気づけるようにするためです", depends_on: "pet_owned=いる", sort_order: 4 },
  // ----- 仕事・学習 -----
  { id: "job", category_id: "work", label: "仕事内容", value_type: "text", refresh_days: 365, importance: 3, question: "どんなお仕事をしていますか？（だいたいでOK）", reason: "仕事に合った提案をするためです", sort_order: 1 },
  { id: "work_hours_week", category_id: "work", label: "1週間の労働時間", value_type: "number", unit: "時間/週", refresh_days: 90, importance: 3, question: "1週間に、だいたい何時間くらい働いていますか？", reason: "働きすぎや時間の余裕を見るためです", sort_order: 2 },
  { id: "work_burden_week", category_id: "work", label: "仕事・勉強の負担（週）", value_type: "text", kind: "periodic", period: "week", refresh_days: 7, importance: 3, question: "{period}、仕事や勉強で負担に感じたことはありましたか？", reason: "くり返し起きている負担を見つけるためです", sort_order: 3 },
  { id: "study", category_id: "work", label: "学習・資格", value_type: "text", refresh_days: 180, importance: 2, question: "いま勉強していること・取りたい資格はありますか？", reason: "目標に合わせた提案をするためです", sort_order: 4 },
  { id: "career_goal", category_id: "work", label: "キャリアの目標", value_type: "text", refresh_days: 180, importance: 2, question: "これからの仕事で、目指していることはありますか？", reason: "長い目で見た提案をするためです", sort_order: 5 },
  // ----- 趣味・個人プロジェクト -----
  { id: "hobbies", category_id: "hobby", label: "趣味", value_type: "text", refresh_days: 365, importance: 2, question: "好きなこと・趣味を教えてください", reason: "生活を楽しくする提案にも役立てるためです", sort_order: 1 },
  { id: "projects", category_id: "hobby", label: "開発中のもの・個人プロジェクト", value_type: "text", refresh_days: 90, importance: 2, question: "いま作っているもの（アプリなど）や、取り組んでいる個人プロジェクトはありますか？", reason: "進み具合を見守り、手伝えることを見つけるためです", sort_order: 2 },
  { id: "goal_progress", category_id: "hobby", label: "目標の進み具合", value_type: "text", refresh_days: 90, importance: 3, question: "いまの目標と、その進み具合を教えてください", reason: "目標に対して遅れていないかを一緒に見るためです", sort_order: 3 },
  // ----- 生活全般（家計カテゴリの外の、週ごとの困りごと） -----
  { id: "life_trouble_week", category_id: "home", label: "生活で困ったこと（週）", value_type: "text", kind: "periodic", period: "week", refresh_days: 7, importance: 4, question: "{period}、生活で困ったこと・面倒だったことはありましたか？", reason: "くり返す困りごとを見つけて、解決策を考えるためです", sort_order: 7 },
  { id: "problem_now", category_id: "work", label: "いま解決したいこと", value_type: "text", refresh_days: 30, importance: 4, question: "いま、解決したいこと・困っていることはありますか？", reason: "いちばん役に立てることから手伝うためです", sort_order: 6 },
  { id: "habit_change", category_id: "health", label: "生活習慣の変化", value_type: "text", refresh_days: 90, importance: 2, question: "この3か月で、生活習慣に変化はありましたか？", reason: "変化に合わせて情報を新しくするためです", sort_order: 5 },
  { id: "improve_wish", category_id: "hobby", label: "いま改善したいこと", value_type: "text", refresh_days: 90, importance: 3, question: "いま、生活の中で改善したいことは何ですか？", reason: "あなたが望む方向に合わせて提案するためです", sort_order: 4 },
];
