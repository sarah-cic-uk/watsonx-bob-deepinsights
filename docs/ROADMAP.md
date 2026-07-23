# Future Work

## High Importance: LLM Integration for Job Ad Parsing and Skills Matching
### 1. Job Ad Parsing
Currently, job ads must be supplied in this format:
```
Role: Senior Software Engineer
Band: 7
Level: L2
Location: London, Hursley
Skills: AWS, javascript, docker, react
```
It would be far easier if we could instead just scrape / supply the job ad directly, instead of having to manually convert it into this format. This is a task that could easily be handled by an LLM with the following process:

#### 1.1. Send the following prompt to an LLM via some sort of RESTful request
Example prompt to try:
```
The following is a job advert. Your response should ONLY include the job ad converted into the strict required format provided.

Job Advert Text
---------------
<INSERT-JOB-AD-TEXT-HERE-AT-RUNTIME>


Required Format
---------------
Role: Senior Software Engineer
Band: 7
Level: L2
Location: London, Hursley
Skills: AWS, javascript, docker, react

Example
---------------
Role: <String>
Band: <String - may be something like 7A, or just 7>
Level: ['L1', 'L2', or 'L3']
Location: <List of Strings, separated by commas>
Skills: <List of String, separated by commas>
```

#### 1.2. Validate the output format is exactly what was expected
Don't do this with an LLM (waste of money), can do it with JS and throw and error to the user if it doesn't work, telling them to just convert it into the format themselves.

#### 1.3. Continue the program as normal, just with the more flexible input 

### 2. Skills Matching
Currently, `src/pipeline/skills.js` matches skills with a hand-written alias map + word-boundary regex, then scores `matched / required`. It works but is brittle: the alias map can never be complete (e.g. "Amazon Web Services" ≠ `aws`), it has no semantic understanding ("built REST microservices" won't match `api design`), and it's a blind present/absent check. An LLM can read the CV like a human reviewer and judge genuine fit - same pattern as the job-ad parsing above.

#### 2.1. Send the CV text + required skills to an LLM via a RESTful request
Example prompt to try:
```
Screen this CV against the required skills. For each skill decide if the CV genuinely demonstrates it. Count closely related tech (e.g. "EKS" → kubernetes) but not skills the candidate says they lack. Respond with ONLY this JSON:
{
   "skills":[
      {
         "skill":"<verbatim required skill>",
         "present":"<bool>",
         "confidence":<0.0-1.0>
      }
   ]
}

Required Skills
---------------
<INSERT-REQUIRED-SKILLS-AT-RUNTIME> # Generated from `src/pipeline/parse.js`

CV Text
---------------
<INSERT-CV-TEXT-AT-RUNTIME>
```

#### 2.2. Validate the output in JS (not with an LLM)
Parse the JSON and check there's one valid entry per required skill (`present` boolean, `confidence` in `[0,1]`). On failure, consider whether we want to fall back to the existing `scoreSkills` regex matcher so the pipeline never hard-stops, or halt program fully.

#### 2.3. Map back onto the existing result shape and continue as normal
Rebuild `matchedSkills` / `missingSkills` / `skillScore` from the LLM output so `filterBySkills()` returns the same contract - no downstream changes needed.